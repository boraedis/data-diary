/**
 * Seeds the `unlogged_travel` table (#323/#363) from the legacy app's two
 * hardcoded travel lists, converting each entry to the code this app keys
 * by.
 *
 * The lists live in the legacy `Data_Diary_App` repo, not this one:
 *
 *   - `functions/views/vis/charts/us_heatmap.js:78` — the LEGACY_TRAVEL
 *     object, 323 counties keyed "CountyName__ST" with empty-string
 *     values (a set, not a map; the values were never read).
 *   - `functions/views/vis/charts/location_heatmap.js:18` — 9 entries,
 *     7 countries plus 2 UAE emirates.
 *
 * Save each as JSON and point this at them. Both inputs accept either the
 * raw object (keys used, values ignored, exactly as legacy stored it) or a
 * plain array of strings, so the legacy source can be pasted across with
 * as little reshaping as possible — reshaping by hand is where entries go
 * missing.
 *
 * Usage — dry run first, which is the default:
 *
 *   npx tsx scripts/seed-unlogged-travel.mjs --counties ./counties.json
 *   npx tsx scripts/seed-unlogged-travel.mjs --counties ./counties.json --countries ./countries.json --commit
 *
 * Writing needs DATABASE_URL. A dry run needs no database at all — it only
 * resolves names — so the reconciliation report can be produced and read
 * before anything is pointed at a database.
 *
 * **Nothing is ever dropped silently.** Every entry that doesn't resolve
 * to exactly one place is listed in the report by name, under why. A
 * county quietly lost at import is invisible forever afterwards, and the
 * legacy list is the only copy.
 *
 * Safe to re-run: writes are upserts on (kind, code).
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";
import { parseLegacyCountyKey, resolveCountyByName } from "../src/lib/geo/us-county-lookup.ts";
import { resolveCountryCode } from "../src/lib/geo/country-lookup.ts";

function parseArgs(argv) {
  const args = { counties: null, countries: null, commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--commit") args.commit = true;
    else if (argv[i] === "--counties") args.counties = argv[(i += 1)];
    else if (argv[i] === "--countries") args.countries = argv[(i += 1)];
  }
  return args;
}

/** Accepts legacy's own object shape or a plain array — see the header. */
function readEntries(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) return parsed.map(String);
  if (parsed && typeof parsed === "object") return Object.keys(parsed);
  throw new Error(`${path}: expected a JSON object or array, got ${typeof parsed}`);
}

function resolveCounties(entries) {
  const rows = [];
  const problems = [];
  for (const entry of entries) {
    const parsed = parseLegacyCountyKey(entry);
    if (!parsed) {
      problems.push({ entry, why: "malformed key (expected \"CountyName__ST\")" });
      continue;
    }
    const result = resolveCountyByName(parsed.countyName, parsed.postalCode);
    if (result.kind === "match") {
      rows.push({ kind: "us_county", code: result.fips, resolvedName: result.name, entry });
    } else if (result.kind === "ambiguous") {
      const options = result.candidates.map((c) => `${c.name} (${c.fips})`).join(" or ");
      problems.push({ entry, why: `ambiguous — could be ${options}; pick one by FIPS` });
    } else if (result.kind === "unknown-state") {
      problems.push({ entry, why: `unknown state code "${parsed.postalCode}"` });
    } else {
      problems.push({ entry, why: `no county named "${parsed.countyName}" in ${parsed.postalCode}` });
    }
  }
  return { rows, problems };
}

function resolveCountries(entries) {
  const rows = [];
  const problems = [];
  for (const entry of entries) {
    const ref = resolveCountryCode(entry);
    if (!ref) {
      // The expected shape of this: legacy's 2 UAE emirates. world-atlas
      // ships no subdivision geometry for the UAE at any resolution this
      // app carries, so there is no polygon below the country to tint —
      // see #323. They are meant to fall out here, not to be forced in.
      problems.push({ entry, why: "world-atlas draws no country by that name (a subdivision?)" });
      continue;
    }
    rows.push({ kind: "country", code: ref.code, resolvedName: ref.name, entry, hasIsoCode: ref.hasIsoCode });
  }
  return { rows, problems };
}

function report(label, { rows, problems }) {
  console.log(`\n${label}: ${rows.length} resolved, ${problems.length} unresolved`);
  const nameCoded = rows.filter((r) => r.hasIsoCode === false);
  if (nameCoded.length) {
    console.log(`  ${nameCoded.length} stored under a name rather than an ISO code (no ISO code exists):`);
    for (const r of nameCoded) console.log(`    ${r.entry} -> ${r.code}`);
  }
  if (problems.length) {
    console.log("  unresolved — decide each of these by hand, none were dropped:");
    for (const p of problems) console.log(`    ${p.entry}: ${p.why}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.counties && !args.countries) {
    console.error("Nothing to do. Pass --counties <path> and/or --countries <path>; see this file's header.");
    process.exit(1);
  }

  const counties = args.counties ? resolveCounties(readEntries(args.counties)) : { rows: [], problems: [] };
  const countries = args.countries ? resolveCountries(readEntries(args.countries)) : { rows: [], problems: [] };

  if (args.counties) report("US counties", counties);
  if (args.countries) report("Countries", countries);

  const rows = [...counties.rows, ...countries.rows];
  const unresolved = counties.problems.length + countries.problems.length;

  if (!args.commit) {
    console.log(`\nDry run — nothing written. ${rows.length} row(s) would be upserted.`);
    if (unresolved) console.log(`Resolve the ${unresolved} entr${unresolved === 1 ? "y" : "ies"} above first, or accept losing them.`);
    console.log("Re-run with --commit (and DATABASE_URL set) to write.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL to write. Per AGENTS.md, that should be the PR branch database (npm run dev:pr), not local dev.");
    process.exit(1);
  }
  await guardAgainstProd({ scriptName: "seed-unlogged-travel.mjs" });

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const row of rows) {
      // first_visited and note are left null by the seed: legacy's lists
      // are dateless, and inventing a date would defeat the column's whole
      // purpose (see the schema comment). They get filled in by hand
      // afterwards, through #367's manage surface.
      await pool.query(
        `insert into unlogged_travel (kind, code) values ($1, $2)
         on conflict (kind, code) do nothing`,
        [row.kind, row.code],
      );
    }
    console.log(`\nWrote ${rows.length} row(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
