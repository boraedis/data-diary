/**
 * Resets every music artist's Spotify identity link (spotify_id + its
 * attached artist_genres rows) so a re-upload of the same export file(s)
 * re-resolves all of them from scratch under the fixed matching logic
 * (#223/#225: resolveArtist now prefers an exact track-id lookup over a
 * guessed name search, and the name-search fallback now verifies the
 * result actually matches the queried name).
 *
 * Deliberately resets EVERY artist, not just the ones a query can prove
 * are wrong. A narrower first pass of this script only cleared artists
 * with spotify_id still null (genres attached but the identity-link
 * UPDATE never completed) — that catches a match that lost a naming
 * collision, but not one that won it: if "DR" happened to be resolved
 * before "DRAM" in some import, it could have claimed Drake's spotify_id
 * with nothing competing for it yet, leaving it looking fully resolved
 * (spotify_id set, genres attached) despite being just as wrong. There's
 * no way to tell that case apart from a correct one by querying the
 * database — the only reliable fix is re-resolving everyone.
 *
 * Deliberately scoped to just these two things:
 *   - musicListens (dates/durations/track names) is never touched — that
 *     data was never wrong, this bug is entirely on the artist/genre side.
 *   - artists.name/aliases rows are never touched — the catalog identity
 *     itself (dedup by name) is correct; only the Spotify link is reset.
 *   - The genres table and its groupId curation (see schema.ts) are a
 *     separate, genre-tag-level concept, not per-artist — untouched.
 *
 * Safe to re-run — an artist with spotify_id already null and no genres
 * attached matches nothing further to reset.
 *
 *   DATABASE_URL=postgres://... node scripts/reset-artist-spotify-resolution.mjs [--commit]
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
  if (COMMIT) await guardAgainstProd({ scriptName: "reset-artist-spotify-resolution.mjs --commit" });

  const [{ rows: linkedRows }, { rows: genreRows }] = await Promise.all([
    pool.query(`select count(*)::int as count from artists where spotify_id is not null`),
    pool.query(`select count(*)::int as count from artist_genres`),
  ]);

  console.log(`\n=== reset-artist-spotify-resolution — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
  console.log(`Artists with a spotify_id set: ${linkedRows[0].count}`);
  console.log(`Total artist_genres links: ${genreRows[0].count}`);

  if (linkedRows[0].count === 0 && genreRows[0].count === 0) {
    console.log("\nNothing to do.");
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log(
      "\nDry run — nothing written. Re-run with --commit to reset all of the above, then re-upload every Spotify export file to re-resolve them."
    );
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cleared = await client.query(`delete from artist_genres`);
    const reset = await client.query(`update artists set spotify_id = null where spotify_id is not null`);
    await client.query("COMMIT");
    console.log(`\nCleared ${cleared.rowCount} artist_genres link(s).`);
    console.log(`Reset spotify_id on ${reset.rowCount} artist(s).`);
    console.log("Re-upload every Spotify export file now — imports are safe to re-run, listens dedupe automatically.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
