/**
 * Removes artists/podcast_shows rows with zero music_listens referencing
 * them — clutter left over from before #244 filtered sub-30s "skip"
 * listens out at import time. Before that fix, every listen (including a
 * few-second skip) got a catalog row created for it if the artist/show
 * hadn't been seen before; deleting the short listens themselves (#244's
 * own cleanup script) left these now-referenceless catalog rows behind.
 * They still show up in the "needs review" genre/category classification
 * workflow (#178) with nothing real to classify.
 *
 * Going forward this can't recur — music-import.ts's sub-30s check runs
 * before any artist/podcast name is ever added to the resolution set, so
 * a skip never creates a catalog row in the first place (#244, #252).
 * This is purely cleanup of what's already there.
 *
 * Safe: artist_genres.artist_id is onDelete: cascade, so deleting an
 * orphaned artist automatically removes its genre links too. Nothing else
 * references either table inbound besides music_listens (which is what
 * "orphan" is defined against here), so there's no other cascade to worry
 * about.
 *
 * Caveat this script can't distinguish: a manually-added artist/show with
 * no listens yet (e.g. added in anticipation of a future import) looks
 * identical to a true orphan. Unlikely in practice for a single-user app
 * that only ever gets these rows from Spotify imports, but worth knowing
 * before running --commit.
 *
 *   DATABASE_URL=postgres://... node scripts/remove-orphaned-music-catalog-rows.mjs [--commit]
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
  if (COMMIT) await guardAgainstProd({ scriptName: "remove-orphaned-music-catalog-rows.mjs --commit" });

  const { rows: orphanArtists } = await pool.query(`
    select id, name from artists a
    where not exists (select 1 from music_listens ml where ml.artist_id = a.id)
    order by id
  `);
  const { rows: orphanShows } = await pool.query(`
    select id, name from podcast_shows p
    where not exists (select 1 from music_listens ml where ml.podcast_show_id = p.id)
    order by id
  `);

  console.log(`\n=== remove-orphaned-music-catalog-rows — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
  console.log(`Orphaned artists (0 listens): ${orphanArtists.length}`);
  console.log(`Orphaned podcast shows (0 listens): ${orphanShows.length}`);

  if (orphanArtists.length === 0 && orphanShows.length === 0) {
    console.log("\nNothing to do.");
    await pool.end();
    return;
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to delete these.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deletedArtists = await client.query(
      `delete from artists where id = any($1::int[])`,
      [orphanArtists.map((a) => a.id)]
    );
    const deletedShows = await client.query(
      `delete from podcast_shows where id = any($1::int[])`,
      [orphanShows.map((s) => s.id)]
    );
    await client.query("COMMIT");
    console.log(`\nDeleted ${deletedArtists.rowCount} artist(s) and ${deletedShows.rowCount} podcast show(s).`);
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
