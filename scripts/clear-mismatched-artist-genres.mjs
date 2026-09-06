/**
 * One-time cleanup for genre links attached by a Spotify match that never
 * actually completed (#223/#225).
 *
 * Before #225, searchArtist trusted Spotify's top search result
 * unconditionally, so a short/ambiguous/misspelled catalog name (e.g.
 * "Hanz", "DR") could get an unrelated real artist's genres attached via
 * artist_genres — and before #223, the subsequent UPDATE that would have
 * set spotify_id then threw a unique-violation (another artist already
 * legitimately holds that id), leaving spotify_id null forever while the
 * wrong genres stayed attached. `artists.spotify_id is null` combined with
 * "has genres attached" is the fingerprint of exactly that failure mode —
 * a clean resolution always finishes with a set spotify_id.
 *
 * This can't tell a genuinely wrong match (the common case, per #225's
 * findings on this repo's own real data — "n o r m a l" tagged with
 * nu-metal genres) apart from a harmless duplicate-name collision (two
 * catalog rows for the same real artist, e.g. "Jethro Tull" written two
 * ways, where the losing row's attached genres happen to be correct
 * anyway). It clears both, on purpose: re-running the Spotify import for
 * the same files (safe — listens are deduplicated, see the upload
 * widget's own note) re-resolves every cleared artist from scratch under
 * the fixed matching logic, which is strictly more trustworthy than
 * guessing which of the 17-ish rows this finds are "probably fine."
 *
 * Safe to re-run — an artist with no attached genres does not match the
 * query below, so a second run touches zero rows.
 *
 *   DATABASE_URL=postgres://... node scripts/clear-mismatched-artist-genres.mjs [--commit]
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

const COMMIT = process.argv.slice(2).includes("--commit");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (COMMIT) await guardAgainstProd({ scriptName: "clear-mismatched-artist-genres.mjs --commit" });

  const { rows } = await pool.query(`
    select a.id, a.name, count(ag.genre_id)::int as genre_count
    from artists a
    join artist_genres ag on ag.artist_id = a.id
    where a.spotify_id is null
    group by a.id, a.name
    order by a.id
  `);

  console.log(`\n=== clear-mismatched-artist-genres — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
  if (rows.length === 0) {
    console.log("Nothing to do — no artist has genres attached with no spotify_id.");
    await pool.end();
    return;
  }

  console.log(`${rows.length} artist(s) with genres attached but no confirmed spotify_id:\n`);
  for (const r of rows) {
    console.log(`  ${r.id}\t${r.name}\t(${r.genre_count} genre${r.genre_count === 1 ? "" : "s"})`);
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to clear these, then re-import to re-resolve them.");
    await pool.end();
    return;
  }

  const ids = rows.map((r) => r.id);
  const { rowCount } = await pool.query(`delete from artist_genres where artist_id = any($1::int[])`, [ids]);
  console.log(`\nCleared ${rowCount} genre link(s) across ${rows.length} artist(s).`);
  console.log("Re-upload the same Spotify export file(s) to re-resolve them — imports are safe to re-run.");

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
