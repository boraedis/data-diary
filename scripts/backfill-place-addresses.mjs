#!/usr/bin/env tsx
/**
 * Fills in `places.address` for places that have coordinates but no
 * address — via REVERSE geocoding (lat/lng -> Google's best formatted
 * address for that point), not the forward migration path.
 *
 * BACKGROUND (#302): the original claim behind this issue — "none of the
 * legacy locations were migrated with their address" — turned out not to
 * be true. `migrate-history.mjs` already reconstructs `address` from
 * legacy's `street_num`/`street_name` fields, and it worked for ~87% of
 * places in production. The other ~13% (id`d against a real read of prod
 * on 2026-09-09: 264 of 2133 non-root places) genuinely never had a street
 * address in legacy either — concentrated in categories like Friends
 * House, Natural, Recreational, and Public, where a place was pinned on a
 * map (a trailhead, a friend's house, a park) but never given a formal
 * address to begin with. There's nothing to "migrate" for those; the data
 * was never captured.
 *
 * Most of them (252 of the 264, same read) DO have real coordinates
 * though, captured however the place was originally pinned — so this
 * script fills the gap the other direction: reverse-geocode each one's
 * existing lat/lng into a human-readable address via
 * `reverseGeocodeAddress` (src/lib/geocode.ts), and write it back. A
 * handful (12, same read) have neither an address nor coordinates and
 * aren't touched here — there's nothing to derive an address from; those
 * need a human to look at them individually.
 *
 * Purely additive: only ever touches a row where `address IS NULL`. A
 * place with an address already — reconstructed by the migration,
 * hand-entered, or previously backfilled — is never re-geocoded or
 * overwritten, regardless of how confident a fresh lookup might be.
 * Existing coordinates are read, never written — this script only ever
 * fills `address`.
 *
 * Usage (defaults to a DRY RUN — prints what each place's address would
 * become without writing anything; pass --commit to write):
 *
 *   DATABASE_URL=postgres://... GOOGLE_MAPS_API_KEY=... \
 *     npx tsx scripts/backfill-place-addresses.mjs [--commit]
 *
 * A dry run still calls the real Geocoding API (that's the whole point —
 * showing what a commit would actually produce), so it costs the same API
 * quota as a real run; it just skips the final UPDATE. Safe to re-run
 * either way: a row this script has already given an address to no longer
 * matches its own `address IS NULL` selection criteria, so re-running
 * (say, to pick up newly-added places) only ever processes what's still
 * missing.
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";
import { reverseGeocodeAddress } from "../src/lib/geocode.ts";

const COMMIT = process.argv.slice(2).includes("--commit");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to your Neon Postgres connection string.");
  process.exit(1);
}
if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.error("Set GOOGLE_MAPS_API_KEY — reverseGeocodeAddress needs it, dry run or not.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// A short, polite pause between requests — Google's Geocoding API has a
// per-second QPS limit, and a few hundred places is cheap enough that
// there's no reason to press against it.
const REQUEST_DELAY_MS = 150;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // Dry runs are safe against any database (no writes happen), so only
  // gate the run that can actually write — see scripts/lib/prod-guard.mjs
  // for why this exists at all.
  if (COMMIT) await guardAgainstProd({ scriptName: "backfill-place-addresses.mjs --commit" });

  console.log(`\n=== backfill-place-addresses — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
  if (!COMMIT) console.log("(dry run — nothing will be written; pass --commit to write)\n");

  const { rows } = await pool.query(
    `select id, name, lat, lng from places
     where address is null and lat is not null and lng is not null
     order by id`
  );

  if (rows.length === 0) {
    console.log("Nothing to do — every place with coordinates already has an address.");
    await pool.end();
    return;
  }

  console.log(`${rows.length} place(s) have coordinates but no address. Reverse-geocoding...\n`);

  let resolved = 0;
  let unresolved = 0;
  let failed = 0;

  for (const row of rows) {
    let address;
    try {
      address = await reverseGeocodeAddress(row.lat, row.lng);
    } catch (error) {
      failed++;
      console.warn(`  #${row.id} ${row.name}: request failed — ${error instanceof Error ? error.message : error}`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (!address) {
      unresolved++;
      console.warn(`  #${row.id} ${row.name} (${row.lat}, ${row.lng}): no address found for this point`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    resolved++;
    console.log(`  #${row.id} ${row.name} -> ${address}`);
    if (COMMIT) {
      await pool.query("update places set address = $1 where id = $2", [address, row.id]);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `\nDone. ${resolved} address(es) ${COMMIT ? "written" : "resolved (dry run, nothing written)"}, ` +
      `${unresolved} coordinate(s) Google couldn't place, ${failed} request failure(s).`
  );
  if (!COMMIT && resolved > 0) {
    console.log("Re-run with --commit to write these.");
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
