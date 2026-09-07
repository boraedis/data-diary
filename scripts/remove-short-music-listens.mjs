/**
 * One-time cleanup for music_listens rows under MIN_LISTEN_MS (30s) — a
 * skip, not a real listen (#244). music-import.ts now filters these out at
 * import time going forward; this removes what's already stored from
 * before that filter existed.
 *
 * This isn't "correcting" a historical record the way the musicListens
 * table comment in schema.ts warns against (reassigning a wrong artist,
 * say) — a sub-30s row was never a meaningful listen event to begin with,
 * the same reasoning recap-entertainment.ts already applies when counting
 * "tracks played". Listening-time totals are unaffected either way: a
 * three-second skip only ever contributed three seconds.
 *
 * Safe to re-run — once these rows are gone, a second run finds none.
 *
 *   DATABASE_URL=postgres://... node scripts/remove-short-music-listens.mjs [--commit]
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

const MIN_LISTEN_MS = 30_000;
const COMMIT = process.argv.slice(2).includes("--commit");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (COMMIT) await guardAgainstProd({ scriptName: "remove-short-music-listens.mjs --commit" });

  const {
    rows: [{ count, total_ms }],
  } = await pool.query(
    `select count(*)::int as count, coalesce(sum(ms_played), 0)::bigint as total_ms
     from music_listens where ms_played < $1`,
    [MIN_LISTEN_MS]
  );

  console.log(`\n=== remove-short-music-listens — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
  console.log(`music_listens rows under ${MIN_LISTEN_MS / 1000}s: ${count} (totaling ${(total_ms / 1000).toFixed(0)}s of listening time)`);

  if (count === 0) {
    console.log("\nNothing to do.");
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to delete these.");
    await pool.end();
    return;
  }

  const { rowCount } = await pool.query(`delete from music_listens where ms_played < $1`, [MIN_LISTEN_MS]);
  console.log(`\nDeleted ${rowCount} row(s).`);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
