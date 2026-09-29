/**
 * Read-only diagnostic for #293: find places under a #177 city-heatmap
 * root whose lat/lng doesn't actually land inside the neighborhood their
 * own catalog hierarchy (id_path/name_path) says they belong to.
 *
 * Why this needs its own check, distinct from the heatmap chart itself:
 * getCityHeatmapData's `resolvedByPlaceId` (src/lib/charts.ts) resolves a
 * place to a neighborhood purely by walking its name_path against the
 * geometry's own feature names (resolveCityFeatureName) — it never looks
 * at the place's lat/lng at all. So the choropleth fill always agrees
 * with the catalog's declared hierarchy, even when a place's actual
 * coordinates are wrong; only the destination dot (plotted straight from
 * lat/lng) would visually show up in the wrong spot. This script is the
 * "does the declared neighborhood's polygon actually contain the point"
 * check the issue asks for, run once per city rather than eyeballed off
 * the map.
 *
 * Four kinds of finding, most to least actionable:
 *
 *   MISMATCH  — the place resolves to neighborhood X by name, but its
 *               point actually falls inside a *different* neighborhood Y.
 *               Strongest signal of a wrong coordinate.
 *   OUTSIDE   — resolves to X by name, but the point falls inside none of
 *               this city's neighborhoods at all (badly off, a different
 *               city, or a real geometry gap wider than expected).
 *   SPELLING  — the name_path doesn't resolve, but one of its own segments
 *               is the *same name* as the neighborhood the point actually
 *               lands in, once case/whitespace/punctuation is ignored
 *               (e.g. catalog "Morningside-Lenox Park" vs. GIS
 *               "Morningside/Lenox Park" — same words, different
 *               separator). Deliberately strict: a real typo or
 *               abbreviation (catalog "Marrieta St Artery" vs. GIS
 *               "Marietta Street Artery") canonicalizes to two different
 *               strings and is reported as UNMAPPED instead, since this
 *               script has no way to tell "obviously the same place,
 *               misspelled" apart from "coincidentally similar name,
 *               actually different" without risking the latter. Not a
 *               coordinate problem at all — the
 *               coordinate is fine, the city's own <city>-names.ts alias
 *               table (see atlanta-names.ts etc.) just doesn't know this
 *               spelling yet. Reported with a ready-to-paste alias-table
 *               line rather than left mixed into UNMAPPED below, since
 *               resolveCityFeatureName is deliberately strict (exact,
 *               alias-table-mediated matching only — see city-config.ts's
 *               own comment on why two neighborhoods sharing a name
 *               across roots can't be resolved by fuzzy matching), so
 *               this case needs a human to add the alias, not a looser
 *               match at resolution time.
 *   UNMAPPED  — the name_path doesn't resolve to any neighborhood at all,
 *               and isn't a same-spelling case either (a genuine alias/
 *               geometry gap — see isPlaceInCity's own comment, e.g.
 *               Atlanta's Briarcliff Woods), but the point *does* land
 *               inside a real neighborhood polygon anyway. Lower
 *               priority: this can mean the coordinate is fine and the
 *               catalog names a genuinely different neighborhood (a real
 *               remap, not a spelling gap) — worth a look, not
 *               necessarily a fix.
 *
 * A place whose name_path resolves to a neighborhood AND whose point
 * lands in that same neighborhood is not reported. Neither is a place
 * whose name_path doesn't resolve and whose point doesn't land anywhere
 * either — that's the ungeocoded/no-matching-geometry case the heatmap
 * chart already renders as an uncoloured destination dot, not something
 * this script can add anything to.
 *
 * This intentionally doesn't touch the database — it only reads and
 * reports. Fixing a flagged place's coordinates is a separate step,
 * through the app's own place editor (#302 protects that flow against
 * wiping coordinates on a failed re-geocode).
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run diagnose:city-place-coords -- [--city=atlanta]
 *
 *   --city   optional, one of CITIES' keys (atlanta, dc-metro, dubai,
 *            nyc, istanbul) — omit to check all five.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as d3 from "d3";
import { feature } from "topojson-client";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { findCityPlaceQaFindings } from "../src/lib/geo/city-place-qa.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to diagnose.");
  process.exit(1);
}

const cityArg = process.argv.find((a) => a.startsWith("--city="))?.split("=")[1];
if (cityArg && !CITIES[cityArg]) {
  console.error(`Unknown --city=${cityArg}. Valid keys: ${Object.keys(CITIES).join(", ")}`);
  process.exit(1);
}
const cityKeys = cityArg ? [cityArg] : Object.keys(CITIES);

function loadCityFeatures(cityKey) {
  const filePath = path.join(__dirname, "..", "src", "data", "geo", `${cityKey}.topo.json`);
  const topo = JSON.parse(readFileSync(filePath, "utf8"));
  return feature(topo, topo.objects[cityKey]).features;
}

const HEADINGS = {
  mismatch: "MISMATCH",
  outside: "OUTSIDE",
  spelling: "SPELLING (not a coordinate bug — add the suggested line to this city's <city>-names.ts, or map it in the app's \"Check places\" modal)",
  unmapped: "UNMAPPED (lower priority — likely a genuine alias/geometry gap, not a coordinate bug)",
};

function describe(f) {
  const declared = f.declared ? `${f.declared.root}/${f.declared.featureName}` : "no declared neighborhood";
  const actual = f.actual ? `${f.actual.root}/${f.actual.name}` : "none of this city's neighborhoods";
  let out = `  #${f.placeId} ${f.placeName} — ${f.namePath}\n    declared: ${declared} — point falls in: ${actual}`;
  if (f.suggestedAlias) {
    out += `\n    suggested alias-table line: ${JSON.stringify(f.suggestedAlias.aliasKey)}: ${JSON.stringify(f.suggestedAlias.aliasValue)},`;
  }
  return out;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT id, name, id_path AS "idPath", name_path AS "namePath", lat, lng
     FROM places
     WHERE lat IS NOT NULL AND lng IS NOT NULL AND id_path IS NOT NULL AND name_path IS NOT NULL`
  );
  await pool.end();

  let totalFlagged = 0;
  for (const cityKey of cityKeys) {
    const city = CITIES[cityKey];
    // Static alias tables only: this script deliberately ignores the
    // app's DB-backed overrides and dismissals so it stays a full,
    // unfiltered audit — the in-app modal is the place to act on findings.
    const findings = findCityPlaceQaFindings(rows, city.sources, loadCityFeatures(cityKey), (f, p) => d3.geoContains(f, p), city.normalize);
    totalFlagged += findings.length;
    console.log(`\n=== ${city.label} (${findings.length} flagged) ===`);
    for (const kind of Object.keys(HEADINGS)) {
      const ofKind = findings.filter((f) => f.kind === kind);
      if (ofKind.length === 0) continue;
      console.log(`\n${HEADINGS[kind]} (${ofKind.length}):`);
      ofKind.forEach((f) => console.log(describe(f)));
    }
    if (findings.length === 0) console.log("  Nothing flagged.");
  }
  console.log(`\n${totalFlagged} place(s) flagged across ${cityKeys.length} cit${cityKeys.length === 1 ? "y" : "ies"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
