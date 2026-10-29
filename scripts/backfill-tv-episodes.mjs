/**
 * One-time backfill: fills the tv_episodes catalog with every season of every
 * show already in the TV catalog. Until now only seasons someone had opened
 * in the log-an-episode picker had rows, so the TV backlog quietly left out
 * the rest of each show. Adding or refreshing a show now syncs all of its
 * seasons (see src/lib/tv-episode-catalog.ts); this covers the shows that
 * were added before that.
 *
 * Safe to re-run: episodes upsert by tmdb_episode_id, so a second run only
 * refreshes their metadata. A show whose TMDB lookup fails is reported by id
 * and skipped; re-running picks it up.
 *
 *   DATABASE_URL=postgres://... TMDB_API_KEY=... npm run backfill:tv-episodes
 */
import { guardAgainstProd } from "./lib/prod-guard.mjs";
import { listTvShowsCatalog } from "../src/lib/days.ts";
import { syncAllTvShowEpisodes } from "../src/lib/tv-episode-catalog.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!process.env.TMDB_API_KEY) {
  console.error("TMDB_API_KEY is not set; the backfill fetches every season from TMDB.");
  process.exit(1);
}
await guardAgainstProd({ scriptName: "backfill-tv-episodes.mjs" });

const shows = await listTvShowsCatalog();
let episodes = 0;
let failed = 0;
for (const show of shows) {
  try {
    episodes += await syncAllTvShowEpisodes(show.id, show.tmdbId);
  } catch (err) {
    failed += 1;
    console.error(`Show #${show.id} failed: ${err?.message ?? err}`);
  }
}

console.log(`Synced ${episodes} episodes across ${shows.length - failed} of ${shows.length} shows.`);
if (failed > 0) {
  console.error(`${failed} show(s) failed. Re-run to retry them.`);
  process.exit(1);
}
