import { upsertTvEpisodeMetadata } from "@/lib/days";
import { getSeasonEpisodes, getTvShowSeasons } from "@/lib/tmdb";

// Fills the local tv_episodes catalog with every season of a show, not just
// the seasons someone has opened in the log-an-episode picker. The TV
// backlog (src/lib/tv-backlog.ts) only counts episodes that have a row here,
// so a season nobody opened would otherwise never show up in it.
//
// Called when a show is added and when it's refreshed (new seasons get
// announced over time), plus once for existing shows by
// scripts/backfill-tv-episodes.mjs. Specials (season 0) are skipped by
// getTvShowSeasons, the same as the picker. Sequential on purpose: a long
// show is a few dozen TMDB requests, and TMDB rate-limits bursts.
//
// Returns the number of episodes synced, for the backfill's summary.
export async function syncAllTvShowEpisodes(showId: number, tmdbId: number): Promise<number> {
  const seasons = await getTvShowSeasons(tmdbId);
  let synced = 0;
  for (const season of seasons) {
    const episodes = await getSeasonEpisodes(tmdbId, season.seasonNumber);
    await upsertTvEpisodeMetadata(showId, episodes);
    synced += episodes.length;
  }
  return synced;
}
