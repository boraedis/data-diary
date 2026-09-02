// Read-side queries over imported listen history — separate from
// src/lib/music-import.ts (the write path) and src/lib/catalog-admin.ts
// (the artists/genres/podcasts catalog CRUD), same file-per-concern split
// this app already uses elsewhere.
import { count, countDistinct, max, min } from "drizzle-orm";
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
