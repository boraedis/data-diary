// Imports Spotify "Extended Streaming History" export entries
// (src/app/api/music/import/route.ts is the only caller). See the
// `musicListens` table comment in schema.ts for why the uploaded file
// itself is never persisted — only the extracted fields ever reach the
// database. Entries arrive already parsed: the client (music-upload-
// panel.tsx) reads and JSON.parses each export file itself so it can split
// a file that's too big for one request into several smaller ones (see
// that file's own comment, and #192) — by the time this module sees them,
// each "file" here may really be one slice of a larger export file.
import { eq, inArray, sql } from "drizzle-orm";
import { artistGenres, artists, genres, musicListens, podcastShows } from "@/db/schema";
import { getDb } from "@/lib/db";
import { MIN_LISTEN_MS } from "@/lib/music";
import { getArtistsForTracks, parseSpotifyTrackId, searchArtist, type SpotifyArtistMatch } from "@/lib/spotify";

// Only the fields this import actually uses — Spotify's export has several
// more (platform, conn_country, shuffle, skipped, ...) nobody reads here.
// spotify_track_uri specifically lets artist resolution below use an exact
// track lookup instead of guessing from the free-text artist name — see
// resolveArtistGenres's own comment.
type SpotifyExportEntry = {
  ts: unknown;
  ms_played: unknown;
  master_metadata_track_name: unknown;
  master_metadata_album_artist_name: unknown;
  master_metadata_album_album_name: unknown;
  spotify_track_uri: unknown;
  episode_name: unknown;
  episode_show_name: unknown;
};

export type MusicImportSummary = {
  filesProcessed: number;
  entriesRead: number;
  listensInserted: number;
  listensSkipped: number;
  artistsCreated: number;
  podcastShowsCreated: number;
  errors: string[];
};

type Db = ReturnType<typeof getDb>;

// One entry per artist still needing a Spotify identity/genre lookup,
// keyed by artistId. `trackId` is a representative track for that artist
// — whichever entry in this import first carried one — used to attempt
// the exact lookup before falling back to a name search; see
// resolveArtistGenres.
type PendingArtistGenreLookup = { name: string; trackId: string | null };

// Resolves every distinct artist name in one bulk pass instead of one
// query per name — src/lib/db.ts uses Neon's HTTP driver, where every
// query is its own separate HTTPS round-trip with no persistent
// connection to amortize it over. A historical import's first chunk can
// have hundreds of never-seen artists; resolving them one at a time (a
// SELECT then an INSERT each) was enough on its own to push a request
// past Vercel's 300s function limit even after #250 batched the Spotify
// side of this same loop (#252) — cutting Spotify calls didn't help
// because the database calls were the larger cost for this file.
//
// Matches against both `name` and `aliases` (so a manually-added alias
// catches an alternate spelling Spotify's export uses without creating a
// duplicate artist) — `&&` is Postgres's array-overlap operator, the bulk
// equivalent of the old per-name `name = any(aliases)` check. Returns a
// map from `name.toLowerCase()` to artist id; `pending` is filled in with
// every artist (existing with spotifyId still null, or brand new) that
// still needs a Spotify genre lookup.
async function bulkResolveArtists(
  db: Db,
  names: string[],
  firstTrackIdByName: Map<string, string | null>,
  pending: Map<number, PendingArtistGenreLookup>,
  summary: MusicImportSummary
): Promise<Map<string, number>> {
  const idByLowerName = new Map<string, number>();
  if (names.length === 0) return idByLowerName;

  const existingRows = await db
    .select({ id: artists.id, name: artists.name, aliases: artists.aliases, spotifyId: artists.spotifyId })
    .from(artists)
    .where(sql`${artists.name} = any(${names}) or ${artists.aliases} && ${names}::text[]`);

  const unmatchedNames: string[] = [];
  for (const name of names) {
    const match = existingRows.find((row) => row.name === name || row.aliases.includes(name));
    if (!match) {
      unmatchedNames.push(name);
      continue;
    }
    idByLowerName.set(name.toLowerCase(), match.id);
    if (match.spotifyId === null) pending.set(match.id, { name, trackId: firstTrackIdByName.get(name) ?? null });
  }

  if (unmatchedNames.length > 0) {
    const inserted = await db
      .insert(artists)
      .values(unmatchedNames.map((name) => ({ name })))
      .onConflictDoNothing({ target: artists.name })
      .returning({ id: artists.id, name: artists.name });
    for (const row of inserted) {
      idByLowerName.set(row.name.toLowerCase(), row.id);
      pending.set(row.id, { name: row.name, trackId: firstTrackIdByName.get(row.name) ?? null });
    }
    summary.artistsCreated += inserted.length;

    // Any name still unresolved lost a race against another row inserted
    // between the select and insert above — re-select those by name.
    const stillMissing = unmatchedNames.filter((name) => !idByLowerName.has(name.toLowerCase()));
    if (stillMissing.length > 0) {
      const rows = await db
        .select({ id: artists.id, name: artists.name, spotifyId: artists.spotifyId })
        .from(artists)
        .where(inArray(artists.name, stillMissing));
      for (const row of rows) {
        idByLowerName.set(row.name.toLowerCase(), row.id);
        if (row.spotifyId === null) pending.set(row.id, { name: row.name, trackId: firstTrackIdByName.get(row.name) ?? null });
      }
    }
  }

  return idByLowerName;
}

// Same bulk-instead-of-one-at-a-time reasoning as bulkResolveArtists — no
// alias matching here, podcastShows.name is the only thing entries match
// against.
async function bulkResolvePodcastShows(db: Db, names: string[], summary: MusicImportSummary): Promise<Map<string, number>> {
  const idByLowerName = new Map<string, number>();
  if (names.length === 0) return idByLowerName;

  const existingRows = await db.select({ id: podcastShows.id, name: podcastShows.name }).from(podcastShows).where(inArray(podcastShows.name, names));
  for (const row of existingRows) idByLowerName.set(row.name.toLowerCase(), row.id);

  const unmatchedNames = names.filter((name) => !idByLowerName.has(name.toLowerCase()));
  if (unmatchedNames.length > 0) {
    const inserted = await db
      .insert(podcastShows)
      .values(unmatchedNames.map((name) => ({ name })))
      .onConflictDoNothing({ target: podcastShows.name })
      .returning({ id: podcastShows.id, name: podcastShows.name });
    for (const row of inserted) idByLowerName.set(row.name.toLowerCase(), row.id);
    summary.podcastShowsCreated += inserted.length;

    const stillMissing = unmatchedNames.filter((name) => !idByLowerName.has(name.toLowerCase()));
    if (stillMissing.length > 0) {
      const rows = await db.select({ id: podcastShows.id, name: podcastShows.name }).from(podcastShows).where(inArray(podcastShows.name, stillMissing));
      for (const row of rows) idByLowerName.set(row.name.toLowerCase(), row.id);
    }
  }

  return idByLowerName;
}

async function applyArtistMatch(db: Db, artistId: number, match: SpotifyArtistMatch): Promise<void> {
  const genreIds: number[] = [];
  for (const genreName of match.genres) {
    const [inserted] = await db
      .insert(genres)
      .values({ name: genreName })
      .onConflictDoNothing({ target: genres.name })
      .returning({ id: genres.id });
    const genreId = inserted?.id ?? (await db.select({ id: genres.id }).from(genres).where(eq(genres.name, genreName)))[0].id;
    genreIds.push(genreId);
  }
  if (genreIds.length > 0) {
    await db
      .insert(artistGenres)
      .values(genreIds.map((genreId) => ({ artistId, genreId })))
      .onConflictDoNothing({ target: [artistGenres.artistId, artistGenres.genreId] });
  }
  // artists.spotifyId is unique, but two different free-text names in the
  // user's own history (a typo, an alternate spelling, "DRAM" vs "DR") can
  // both legitimately resolve to the same real Spotify artist — the
  // second row to claim it would otherwise throw a unique-violation on a
  // plain UPDATE (see #223). Guarding with NOT EXISTS makes that a benign
  // no-op instead: genres above are still attached to this row either
  // way, only the canonical spotifyId link is skipped since another row
  // already legitimately holds it.
  await db
    .update(artists)
    .set({ spotifyId: match.spotifyId })
    .where(
      sql`${artists.id} = ${artistId} and not exists (
        select 1 from artists as existing where existing.spotify_id = ${match.spotifyId}
      )`
    );
}

// Resolves every artist queued by getOrCreateArtistId in one batched pass,
// after the main entry loop finishes (that loop only needs artist *ids* to
// build listen rows, not genres, so nothing about it depends on this
// happening first or interleaved).
//
// A historical import can have hundreds of never-seen artists. Resolving
// each one individually — the exact track lookup is 2 sequential Spotify
// requests, tried before the 1-request name-search fallback — was enough
// to push a single request past Vercel's 300s function limit in
// production (#249). Spotify's "get several tracks"/"get several artists"
// endpoints (50 ids per request) turn that into roughly N/25 requests
// instead of up to 2N, which is what actually fixes the timeout rather
// than just working around it.
//
// If the batched track/artist lookup itself fails outright (a real
// network error, not just some ids not resolving — Spotify returns a null
// slot for those, not an error), every artist that would have used it
// falls through to the same one-by-one name-search path this used before
// — slower, but the existing "missing genres beats a failed import"
// contract stays intact either way.
async function resolveArtistGenres(
  db: Db,
  pending: Map<number, PendingArtistGenreLookup>,
  summary: MusicImportSummary
): Promise<void> {
  if (pending.size === 0) return;

  const withTrackId: { artistId: number; name: string; trackId: string }[] = [];
  const needsNameSearch: { artistId: number; name: string }[] = [];
  for (const [artistId, { name, trackId }] of pending) {
    if (trackId) {
      withTrackId.push({ artistId, name, trackId });
    } else {
      needsNameSearch.push({ artistId, name });
    }
  }

  let matchByTrackId = new Map<string, SpotifyArtistMatch>();
  if (withTrackId.length > 0) {
    try {
      matchByTrackId = await getArtistsForTracks([...new Set(withTrackId.map((a) => a.trackId))]);
    } catch (error) {
      summary.errors.push(
        `Batch Spotify track lookup failed for ${withTrackId.length} artist(s): ${error instanceof Error ? error.message : "unknown error"} — falling back to name search.`
      );
    }
  }

  for (const { artistId, name, trackId } of withTrackId) {
    const match = matchByTrackId.get(trackId);
    if (!match) {
      needsNameSearch.push({ artistId, name });
      continue;
    }
    try {
      await applyArtistMatch(db, artistId, match);
    } catch (error) {
      summary.errors.push(
        `Spotify genre lookup failed for "${name}": ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  for (const { artistId, name } of needsNameSearch) {
    try {
      const match = await searchArtist(name);
      if (match) await applyArtistMatch(db, artistId, match);
    } catch (error) {
      // Spotify lookup failures shouldn't fail the whole import — the
      // artist row still gets created/matched, just without genres for
      // now; spotifyId stays null so the next import retries it.
      summary.errors.push(
        `Spotify genre lookup failed for "${name}": ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const INSERT_CHUNK_SIZE = 500;

export async function importSpotifyExport(files: { name: string; entries: unknown[] }[]): Promise<MusicImportSummary> {
  const db = getDb();
  const summary: MusicImportSummary = {
    filesProcessed: 0,
    entriesRead: 0,
    listensInserted: 0,
    listensSkipped: 0,
    artistsCreated: 0,
    podcastShowsCreated: 0,
    errors: [],
  };

  // First pass: parse and filter every entry, but don't touch the database
  // yet — just collect what artist/podcast names actually need resolving
  // (see bulkResolveArtists/bulkResolvePodcastShows for why bulk beats
  // resolving as we go here) plus, per artist name, a representative
  // track id (upgraded from null to a real one if a later entry for the
  // same name has one) for the exact-match Spotify lookup.
  type ParsedListenEntry = {
    playedAt: Date;
    msPlayed: number;
    trackName: string | null;
    albumName: string | null;
    episodeName: string | null;
    podcastShowName: string | null;
    artistName: string | null;
  };
  const parsedEntries: ParsedListenEntry[] = [];
  const distinctArtistNames = new Set<string>();
  const distinctPodcastShowNames = new Set<string>();
  const firstTrackIdByArtistName = new Map<string, string | null>();

  for (const file of files) {
    const entries = file.entries as SpotifyExportEntry[];
    summary.filesProcessed++;
    summary.entriesRead += entries.length;

    for (const entry of entries) {
      const ts = asString(entry.ts);
      const msPlayed = asNumber(entry.ms_played);
      const playedAt = ts ? new Date(ts) : null;
      if (!playedAt || Number.isNaN(playedAt.getTime()) || msPlayed === null) {
        summary.listensSkipped++;
        continue;
      }
      // Below MIN_LISTEN_MS this was a skip, not a play (#244) — checked
      // before any artist/podcast resolution so a track only ever clicked
      // through never creates a catalog row for it either.
      if (msPlayed < MIN_LISTEN_MS) {
        summary.listensSkipped++;
        continue;
      }

      // Trimmed here (not just non-empty-checked) since this is the name
      // that gets compared/inserted downstream — matches the old
      // per-entry resolve functions' own `rawName.trim()`.
      const podcastShowName = asString(entry.episode_show_name)?.trim() || null;
      const artistName = asString(entry.master_metadata_album_artist_name)?.trim() || null;

      if (podcastShowName) {
        distinctPodcastShowNames.add(podcastShowName);
      } else if (artistName) {
        distinctArtistNames.add(artistName);
        const trackId = parseSpotifyTrackId(entry.spotify_track_uri);
        const current = firstTrackIdByArtistName.get(artistName);
        if (current === undefined || (current === null && trackId)) {
          firstTrackIdByArtistName.set(artistName, trackId);
        }
      }

      parsedEntries.push({
        playedAt,
        msPlayed,
        trackName: asString(entry.master_metadata_track_name),
        albumName: asString(entry.master_metadata_album_album_name),
        episodeName: asString(entry.episode_name),
        podcastShowName,
        artistName,
      });
    }
  }

  const pendingArtistGenreLookups = new Map<number, PendingArtistGenreLookup>();
  const [artistIdByLowerName, podcastShowIdByLowerName] = await Promise.all([
    bulkResolveArtists(db, [...distinctArtistNames], firstTrackIdByArtistName, pendingArtistGenreLookups, summary),
    bulkResolvePodcastShows(db, [...distinctPodcastShowNames], summary),
  ]);

  await resolveArtistGenres(db, pendingArtistGenreLookups, summary);

  const rows: (typeof musicListens.$inferInsert)[] = parsedEntries.map((entry) => ({
    playedAt: entry.playedAt,
    msPlayed: entry.msPlayed,
    trackName: entry.trackName,
    artistId: entry.artistName ? (artistIdByLowerName.get(entry.artistName.toLowerCase()) ?? null) : null,
    albumName: entry.albumName,
    episodeName: entry.episodeName,
    podcastShowId: entry.podcastShowName ? (podcastShowIdByLowerName.get(entry.podcastShowName.toLowerCase()) ?? null) : null,
  }));

  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const inserted = await db.insert(musicListens).values(chunk).onConflictDoNothing().returning({ id: musicListens.id });
    summary.listensInserted += inserted.length;
  }
  summary.listensSkipped += rows.length - summary.listensInserted;

  return summary;
}
