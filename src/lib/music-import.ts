// Imports Spotify "Extended Streaming History" export entries
// (src/app/api/music/import/route.ts is the only caller). See the
// `musicListens` table comment in schema.ts for why the uploaded file
// itself is never persisted — only the extracted fields ever reach the
// database. Entries arrive already parsed: the client (music-upload-
// panel.tsx) reads and JSON.parses each export file itself so it can split
// a file that's too big for one request into several smaller ones (see
// that file's own comment, and #192) — by the time this module sees them,
// each "file" here may really be one slice of a larger export file.
import { eq, or, sql } from "drizzle-orm";
import { artistGenres, artists, genres, musicListens, podcastShows } from "@/db/schema";
import { getDb } from "@/lib/db";
import { searchArtist } from "@/lib/spotify";

// Only the fields this import actually uses — Spotify's export has several
// more (platform, conn_country, shuffle, skipped, ...) nobody reads here.
type SpotifyExportEntry = {
  ts: unknown;
  ms_played: unknown;
  master_metadata_track_name: unknown;
  master_metadata_album_artist_name: unknown;
  master_metadata_album_album_name: unknown;
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

// Resolves an artist name to a catalog row, matching against both `name`
// and `aliases` (so a manually-added alias catches an alternate spelling
// Spotify's export uses without creating a duplicate artist). Brand new
// rows get a best-effort Spotify genre lookup; an existing row missing
// genres (spotifyId still null — e.g. a previous lookup failed or found no
// match) gets one retry per import rather than being skipped forever.
async function resolveArtist(
  db: Db,
  cache: Map<string, number>,
  rawName: string,
  summary: MusicImportSummary
): Promise<number | null> {
  const name = rawName.trim();
  if (!name) return null;
  const cacheKey = name.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [existing] = await db
    .select({ id: artists.id, spotifyId: artists.spotifyId })
    .from(artists)
    .where(or(eq(artists.name, name), sql`${name} = any(${artists.aliases})`));

  let artistId: number;
  let needsGenreLookup: boolean;
  if (existing) {
    artistId = existing.id;
    needsGenreLookup = existing.spotifyId === null;
  } else {
    const [inserted] = await db
      .insert(artists)
      .values({ name })
      .onConflictDoNothing({ target: artists.name })
      .returning({ id: artists.id });
    if (inserted) {
      artistId = inserted.id;
      summary.artistsCreated++;
    } else {
      // Lost a race against another row inserted between the select and
      // insert above (or matches an existing name we didn't catch via the
      // alias search) — re-select by name.
      const [row] = await db.select({ id: artists.id }).from(artists).where(eq(artists.name, name));
      artistId = row.id;
    }
    needsGenreLookup = true;
  }

  if (needsGenreLookup) {
    try {
      const match = await searchArtist(name);
      if (match) {
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
        await db.update(artists).set({ spotifyId: match.spotifyId }).where(eq(artists.id, artistId));
      }
    } catch (error) {
      // Spotify lookup failures shouldn't fail the whole import — the
      // artist row still gets created/matched, just without genres for
      // now; spotifyId stays null so the next import retries it.
      summary.errors.push(
        `Spotify genre lookup failed for "${name}": ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  cache.set(cacheKey, artistId);
  return artistId;
}

async function resolvePodcastShow(db: Db, cache: Map<string, number>, rawName: string, summary: MusicImportSummary): Promise<number | null> {
  const name = rawName.trim();
  if (!name) return null;
  const cacheKey = name.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [inserted] = await db
    .insert(podcastShows)
    .values({ name })
    .onConflictDoNothing({ target: podcastShows.name })
    .returning({ id: podcastShows.id });
  let showId: number;
  if (inserted) {
    showId = inserted.id;
    summary.podcastShowsCreated++;
  } else {
    showId = (await db.select({ id: podcastShows.id }).from(podcastShows).where(eq(podcastShows.name, name)))[0].id;
  }
  cache.set(cacheKey, showId);
  return showId;
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

  const artistIdCache = new Map<string, number>();
  const podcastShowIdCache = new Map<string, number>();
  const rows: (typeof musicListens.$inferInsert)[] = [];

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

      const podcastShowName = asString(entry.episode_show_name);
      const artistName = asString(entry.master_metadata_album_artist_name);

      let artistId: number | null = null;
      let podcastShowId: number | null = null;
      if (podcastShowName) {
        podcastShowId = await resolvePodcastShow(db, podcastShowIdCache, podcastShowName, summary);
      } else if (artistName) {
        artistId = await resolveArtist(db, artistIdCache, artistName, summary);
      }

      rows.push({
        playedAt,
        msPlayed,
        trackName: asString(entry.master_metadata_track_name),
        artistId,
        albumName: asString(entry.master_metadata_album_album_name),
        episodeName: asString(entry.episode_name),
        podcastShowId,
      });
    }
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const inserted = await db.insert(musicListens).values(chunk).onConflictDoNothing().returning({ id: musicListens.id });
    summary.listensInserted += inserted.length;
  }
  summary.listensSkipped += rows.length - summary.listensInserted;

  return summary;
}
