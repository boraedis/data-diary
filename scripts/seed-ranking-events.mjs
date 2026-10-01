/**
 * One-time seed for the ranking history (#546): logs each current top-10 as
 * `add` events, so replaying the delta log reproduces today's list and every
 * later save diffs against a log that starts complete.
 *
 * Legacy only ever stored the current list, so this is the earliest point
 * the history can honestly start — the events are stamped now, not
 * back-dated to when a film was really ranked.
 *
 * Per list (movies, books), skipped if that list already has any events, so
 * it never doubles up and is safe to re-run. Run it after the
 * `movie_ranking_events`/`book_ranking_events` tables exist (drizzle-kit
 * push).
 *
 *   DATABASE_URL=postgres://... node scripts/seed-ranking-events.mjs [--commit]
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

const COMMIT = process.argv.slice(2).includes("--commit");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string.");
  process.exit(1);
}

const LISTS = [
  { name: "movies", rankings: "movie_rankings", events: "movie_ranking_events", fk: "movie_id" },
  { name: "books", rankings: "book_rankings", events: "book_ranking_events", fk: "book_id" },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (COMMIT) await guardAgainstProd({ scriptName: "seed-ranking-events.mjs --commit" });
  console.log(`\n=== seed-ranking-events — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);

  for (const list of LISTS) {
    const {
      rows: [{ ranked, logged }],
    } = await pool.query(
      `select (select count(*) from ${list.rankings})::int as ranked,
              (select count(*) from ${list.events})::int as logged`
    );
    if (logged > 0) {
      console.log(`${list.name}: already has ${logged} event(s) — skipped.`);
      continue;
    }
    if (ranked === 0) {
      console.log(`${list.name}: no current ranking — nothing to seed.`);
      continue;
    }
    if (!COMMIT) {
      console.log(`${list.name}: would log ${ranked} add event(s).`);
      continue;
    }
    const { rowCount } = await pool.query(
      `insert into ${list.events} (${list.fk}, kind, to_rank)
       select ${list.fk}, 'add', rank from ${list.rankings}`
    );
    console.log(`${list.name}: logged ${rowCount} add event(s).`);
  }

  if (!COMMIT) console.log("\nDry run — nothing written. Re-run with --commit.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
