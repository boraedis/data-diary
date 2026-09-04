/**
 * One-time backfill for movie_watches/tv_episode_watches rows written
 * before duration and location became required entries (#64).
 *
 * The legacy Firestore export never recorded a per-watch duration for
 * movies or TV episodes — it only ever had the catalog's own runtime,
 * applied client-side as a *default* going forward per issue #61 (see
 * migrate-history.mjs's transformMovieWatches/transformTvEpisodeWatches
 * comments for why). A real chunk of historical rows also never recorded
 * a location at all. Once #64 made both fields required, every day
 * containing one of these rows could no longer be re-saved (the whole
 * day's entertainment section validates and writes as one batch) — this
 * closes that gap:
 *
 *   - duration_minutes: backfilled from the linked movie's/episode's own
 *     runtime_minutes, wherever the catalog actually has one (204/204
 *     movie watches and 2162/2165 episode watches, checked against the
 *     real data before writing this). The handful with no runtime
 *     anywhere (not even on TMDB) are left null — there's nothing to
 *     derive them from — and need a manual fix via the entry form's
 *     per-row edit modal (movies-section.tsx's existing one, or TV's new
 *     TvEpisodeRowEditModal).
 *   - location_type: backfilled to a new "Unknown" entertainment location
 *     type for any row that has none. entertainmentLocationTypes is
 *     plain free text matched by name (see the schema.ts comment above
 *     it), so this is just another catalog value, not a schema change —
 *     an honest placeholder for "legacy genuinely didn't record this,"
 *     not a guess at a real location.
 *
 * Safe to re-run — every UPDATE is scoped to "... WHERE column IS NULL",
 * so a second run touches zero rows.
 *
 *   DATABASE_URL=postgres://... node scripts/backfill-entertainment-duration-location.mjs
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to backfill.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // This script writes unconditionally (no --commit flag to gate on), so
  // the prod check has to run before anything else — see
  // scripts/lib/prod-guard.mjs for why this exists.
  await guardAgainstProd({ scriptName: "backfill-entertainment-duration-location.mjs" });

  const {
    rows: [{ id: unknownLocationTypeId }],
  } = await pool.query(
    `insert into entertainment_location_types (name) values ('Unknown')
     on conflict (name) do update set name = excluded.name
     returning id`
  );
  console.log(`"Unknown" location type is catalog id ${unknownLocationTypeId}.`);

  const movieDuration = await pool.query(
    `update movie_watches mw
     set duration_minutes = m.runtime_minutes
     from movies m
     where m.id = mw.movie_id and mw.duration_minutes is null and m.runtime_minutes is not null`
  );
  console.log(`movie_watches.duration_minutes backfilled from catalog runtime: ${movieDuration.rowCount}`);

  const episodeDuration = await pool.query(
    `update tv_episode_watches tw
     set duration_minutes = e.runtime_minutes
     from tv_episodes e
     where e.id = tw.episode_id and tw.duration_minutes is null and e.runtime_minutes is not null`
  );
  console.log(`tv_episode_watches.duration_minutes backfilled from catalog runtime: ${episodeDuration.rowCount}`);

  const movieLocation = await pool.query(`update movie_watches set location_type = 'Unknown' where location_type is null`);
  console.log(`movie_watches.location_type backfilled to "Unknown": ${movieLocation.rowCount}`);

  const episodeLocation = await pool.query(
    `update tv_episode_watches set location_type = 'Unknown' where location_type is null`
  );
  console.log(`tv_episode_watches.location_type backfilled to "Unknown": ${episodeLocation.rowCount}`);

  const {
    rows: [{ count: stillMissingDuration }],
  } = await pool.query(
    `select count(*)::int as count from (
       select duration_minutes from movie_watches where duration_minutes is null
       union all
       select duration_minutes from tv_episode_watches where duration_minutes is null
     ) t`
  );
  if (stillMissingDuration > 0) {
    console.log(
      `\n${stillMissingDuration} row(s) still have no duration — no runtime anywhere to backfill from. ` +
        `Fix these individually via the entry form's edit modal.`
    );
  } else {
    console.log("\nEvery movie/TV watch now has a duration.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
