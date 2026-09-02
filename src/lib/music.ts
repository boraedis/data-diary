// Read-side queries over imported listen history — separate from
// src/lib/music-import.ts (the write path) and src/lib/catalog-admin.ts
// (the artists/genres/podcasts catalog CRUD), same file-per-concern split
// this app already uses elsewhere.
import { count, countDistinct, desc, eq, max, min, sum } from "drizzle-orm";
import { genres, musicListens, podcastShows } from "@/db/schema";
import { getDb } from "@/lib/db";

export type MusicListenStats = {
  totalListens: number;
  uniqueArtists: number;
  uniquePodcastShows: number;
  earliestPlayedAt: string | null;
  latestPlayedAt: string | null;
};

export async function getMusicListenStats(): Promise<MusicListenStats> {
  const db = getDb();
  const [row] = await db
    .select({
      totalListens: count(),
      uniqueArtists: countDistinct(musicListens.artistId),
      uniquePodcastShows: countDistinct(musicListens.podcastShowId),
      earliestPlayedAt: min(musicListens.playedAt),
      latestPlayedAt: max(musicListens.playedAt),
    })
    .from(musicListens);

  return {
    totalListens: row.totalListens,
    uniqueArtists: row.uniqueArtists,
    uniquePodcastShows: row.uniquePodcastShows,
    earliestPlayedAt: row.earliestPlayedAt?.toISOString() ?? null,
    latestPlayedAt: row.latestPlayedAt?.toISOString() ?? null,
  };
}

export type MusicCurationStats = {
  totalGenres: number;
  groupedGenres: number;
  totalPodcastShows: number;
  categorizedPodcastShows: number;
};

// The two catalogs the import pipeline populates automatically but can
// never finish curating on its own: a genre's broad group and a podcast
// show's category are both hand-assigned (see the `genres`/`podcastShows`
// table comments in schema.ts for why neither has an API source). This is
// what backs the "needs review" progress bars on the music manage page —
// `count(column)` here is a plain SQL COUNT(column), which only counts
// non-null values, so it doubles as the "assigned" count for free.
export async function getMusicCurationStats(): Promise<MusicCurationStats> {
  const db = getDb();
  const [[genreRow], [showRow]] = await Promise.all([
    db.select({ total: count(), grouped: count(genres.groupId) }).from(genres),
    db.select({ total: count(), categorized: count(podcastShows.categoryId) }).from(podcastShows),
  ]);

  return {
    totalGenres: genreRow.total,
    groupedGenres: genreRow.grouped,
    totalPodcastShows: showRow.total,
    categorizedPodcastShows: showRow.categorized,
  };
}

// --- Per-artist / per-show listen breakdowns --------------------------
// Backs the artist and podcast-show detail pages — "what did I actually
// listen to by this artist/show, and for how long" grouped straight out of
// musicListens rather than needing a separate rollup table: this app's
// listen counts are personal-scale (thousands, not billions), so a GROUP
// BY over the raw rows is cheap enough to run at page-load time.

export type AlbumListenSummary = { albumName: string | null; totalMs: number; playCount: number };
export type TrackListenSummary = { trackName: string | null; albumName: string | null; totalMs: number; playCount: number };

export async function getArtistAlbums(artistId: number): Promise<AlbumListenSummary[]> {
  const db = getDb();
  const totalMs = sum(musicListens.msPlayed).mapWith(Number);
  const rows = await db
    .select({ albumName: musicListens.albumName, totalMs, playCount: count() })
    .from(musicListens)
    .where(eq(musicListens.artistId, artistId))
    .groupBy(musicListens.albumName)
    .orderBy(desc(totalMs));
  return rows.map((r) => ({ ...r, totalMs: r.totalMs ?? 0 }));
}

export async function getArtistTracks(artistId: number): Promise<TrackListenSummary[]> {
  const db = getDb();
  const totalMs = sum(musicListens.msPlayed).mapWith(Number);
  const rows = await db
    .select({ trackName: musicListens.trackName, albumName: musicListens.albumName, totalMs, playCount: count() })
    .from(musicListens)
    .where(eq(musicListens.artistId, artistId))
    .groupBy(musicListens.trackName, musicListens.albumName)
    .orderBy(desc(totalMs));
  return rows.map((r) => ({ ...r, totalMs: r.totalMs ?? 0 }));
}

export type EpisodeListenSummary = { episodeName: string | null; totalMs: number; playCount: number };

export async function getPodcastShowEpisodes(showId: number): Promise<EpisodeListenSummary[]> {
  const db = getDb();
  const totalMs = sum(musicListens.msPlayed).mapWith(Number);
  const rows = await db
    .select({ episodeName: musicListens.episodeName, totalMs, playCount: count() })
    .from(musicListens)
    .where(eq(musicListens.podcastShowId, showId))
    .groupBy(musicListens.episodeName)
    .orderBy(desc(totalMs));
  return rows.map((r) => ({ ...r, totalMs: r.totalMs ?? 0 }));
}
