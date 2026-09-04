#!/usr/bin/env node
/**
 * One-time backfill for movie_watchlist/movie_rankings/book_watchlist/
 * book_rankings (issue #124) — these were dropped in #79 (dead weight until
 * there was a real UI) and re-added to the schema once this issue's
 * add/remove/reorder pages existed. This pulls the real legacy data back
 * out of Firestore and resolves it against the movies/books catalogs
 * migrate-history.mjs already populated.
 *
 * Legacy Firestore shapes (verified directly against the real data,
 * 2026-09-04 — see this issue's own body for how):
 *   - entertainment/watchlists.movies: {fsMediaId: dayNumberAdded}
 *   - entertainment/rankings.movies: ordered array of up to 10 fsMediaIds
 *   - entertainment/watchlists.books / .rankings.books: same shapes, but
 *     BOTH WERE EMPTY ARRAYS on the real data. The legacy books
 *     watchlist/ranking *edit* pages had a wrong-namespace bug (they called
 *     the movies API instead of the books API — see this issue for the
 *     exact broken files), so nothing was ever actually saved through them
 *     for books; there's nothing trustworthy to migrate. This script still
 *     handles the books side generically (in case that ever turns out
 *     wrong on a different export), but WARNS AND REFUSES TO WRITE if it
 *     ever finds non-empty books data — that data's quality was never
 *     verified, per this issue's own data-quality warning, so a human needs
 *     to look at it first rather than have this script trust it blindly.
 *
 * fsMediaId -> Postgres id resolution: searchs/media[fsMediaId].tmdb_id is
 * looked up against movies.tmdb_id (both catalogs are already fully
 * migrated by migrate-history.mjs; this script only ever reads that table,
 * never writes to it). A watchlist/ranking entry whose movie isn't found in
 * the local catalog is reported and skipped rather than aborting the run.
 *
 *   FIREBASE_SERVICE_ACCOUNT=/path/to/key.json DATABASE_URL=postgres://... \
 *     node scripts/migrate-watchlist-rankings.mjs [--commit]
 *
 * Defaults to a dry run — prints exactly what it would write, writes
 * nothing. Pass --commit to actually write.
 *
 * Safe to re-run: watchlist rows are inserted ON CONFLICT DO NOTHING
 * (keyed on movie_id/book_id, so a second run never overwrites an addedAt
 * a person has since edited by hand), and the ranking tables are replaced
 * wholesale every run (rank is the row's whole identity, same "replace on
 * save" shape the app's own setMovieRanking/setBookRanking use) — so
 * running this twice just re-asserts the same legacy order, it doesn't
 * duplicate or drift.
 */
import { readFileSync } from "fs";
import admin from "firebase-admin";
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

const COMMIT = process.argv.includes("--commit");

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT to the path of the legacy service account key JSON.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to migrate into.");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT, "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const fs = admin.firestore();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const EPOCH = new Date(2000, 3, 20); // 2000/04/20, local time — same epoch migrate-history.mjs uses
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDateColumn(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dateFromDaynum(daynum) {
  const d = new Date(EPOCH);
  d.setDate(d.getDate() + daynum);
  return d;
}

async function main() {
  if (!COMMIT) {
    console.log("(dry run — nothing will be written; pass --commit to write)\n");
  }
  await guardAgainstProd({ scriptName: "migrate-watchlist-rankings.mjs" });

  const [mediaDoc, watchlistsDoc, rankingsDoc] = await Promise.all([
    fs.collection("searchs").doc("media").get(),
    fs.collection("entertainment").doc("watchlists").get(),
    fs.collection("entertainment").doc("rankings").get(),
  ]);
  const media = mediaDoc.data() ?? {};
  const watchlistMovies = watchlistsDoc.data()?.movies ?? {};
  const rankingMovies = rankingsDoc.data()?.movies ?? [];
  const watchlistBooks = watchlistsDoc.data()?.books ?? [];
  const rankingBooks = rankingsDoc.data()?.books ?? [];

  // --- Books: refuse to guess if there's ever real data here -------------
  if (watchlistBooks.length > 0 || rankingBooks.length > 0) {
    console.error(
      "entertainment/watchlists.books or entertainment/rankings.books is non-empty on this export.\n" +
        "This script was written assuming both are empty (verified true on the real data as of " +
        "2026-09-04 — see issue #124's data-quality warning about the legacy books watchlist/ranking " +
        "edit pages calling the wrong API). Since that assumption doesn't hold here, this needs a human " +
        "to look at the actual values before trusting them — aborting without writing anything.\n"
    );
    process.exit(1);
  }
  console.log("Books watchlist/ranking: both empty, nothing to migrate for books.\n");

  // --- Movies: resolve fsMediaId -> Postgres movie id ---------------------
  async function resolveMovieId(fsMediaId) {
    const tmdbId = media[fsMediaId]?.tmdb_id;
    if (!tmdbId) return { ok: false, reason: `${fsMediaId}: not found in searchs/media` };
    const { rows } = await pool.query(`select id from movies where tmdb_id = $1`, [tmdbId]);
    if (rows.length === 0) return { ok: false, reason: `${fsMediaId} (tmdb ${tmdbId}): no matching row in movies` };
    return { ok: true, movieId: rows[0].id, title: media[fsMediaId]?.name ?? "(untitled)" };
  }

  console.log(`Watchlist: ${Object.keys(watchlistMovies).length} movie(s) in Firestore`);
  const watchlistToInsert = [];
  for (const [fsMediaId, daynum] of Object.entries(watchlistMovies)) {
    const resolved = await resolveMovieId(fsMediaId);
    if (!resolved.ok) {
      console.log(`  SKIP ${resolved.reason}`);
      continue;
    }
    const addedAt = toDateColumn(dateFromDaynum(daynum));
    console.log(`  ${resolved.title} — added ${addedAt}`);
    watchlistToInsert.push({ movieId: resolved.movieId, addedAt });
  }

  console.log(`\nRanking: ${rankingMovies.length} movie(s) in Firestore`);
  const rankingToInsert = [];
  for (const [i, fsMediaId] of rankingMovies.entries()) {
    const resolved = await resolveMovieId(fsMediaId);
    if (!resolved.ok) {
      console.log(`  SKIP rank ${i + 1}: ${resolved.reason}`);
      continue;
    }
    console.log(`  #${rankingToInsert.length + 1} ${resolved.title}`);
    rankingToInsert.push(resolved.movieId);
  }

  if (!COMMIT) {
    console.log(
      `\nDry run only. Would insert ${watchlistToInsert.length} watchlist row(s) and ${rankingToInsert.length} ranking row(s). Pass --commit to write.`
    );
    return;
  }

  for (const { movieId, addedAt } of watchlistToInsert) {
    await pool.query(
      `insert into movie_watchlist (movie_id, added_at) values ($1, $2) on conflict (movie_id) do nothing`,
      [movieId, addedAt]
    );
  }
  console.log(`\nInserted/confirmed ${watchlistToInsert.length} movie_watchlist row(s).`);

  await pool.query(`delete from movie_rankings`);
  for (const [i, movieId] of rankingToInsert.entries()) {
    await pool.query(`insert into movie_rankings (rank, movie_id) values ($1, $2)`, [i + 1, movieId]);
  }
  console.log(`Replaced movie_rankings with ${rankingToInsert.length} row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
