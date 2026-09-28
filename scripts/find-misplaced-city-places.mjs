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
 * Three kinds of finding, most to least actionable:
 *
 *   MISMATCH  — the place resolves to neighborhood X by name, but its
 *               point actually falls inside a *different* neighborhood Y.
 *               Strongest signal of a wrong coordinate.
 *   OUTSIDE   — resolves to X by name, but the point falls inside none of
 *               this city's neighborhoods at all (badly off, a different
 *               city, or a real geometry gap wider than expected).
 *   UNMAPPED  — the name_path doesn't resolve to any neighborhood at all
 *               (an alias/geometry gap — see isPlaceInCity's own comment,
 *               e.g. Atlanta's Briarcliff Woods), but the point *does*
 *               land inside a real neighborhood polygon anyway. Lower
 *               priority: this can mean the coordinate is fine and it's
 *               just an alias-table gap, not a coordinate bug — worth a
 *               look, not necessarily a fix.
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
import { resolveCityFeatureName, isPlaceInCity } from "../src/lib/geo/resolve-city-place.ts";

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

// Same file naming convention loadCityGeometryNames (charts.ts) relies
// on: src/data/geo/<cityKey>.topo.json, object key === the city's Record
// key.
function loadCityFeatures(cityKey) {
  const filePath = path.join(__dirname, "..", "src", "data", "geo", `${cityKey}.topo.json`);
  const topo = JSON.parse(readFileSync(filePath, "utf8"));
  const collection = feature(topo, topo.objects[cityKey]);
  return collection.features; // each carries properties.{root,name}
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
    const geometryFeatures = loadCityFeatures(cityKey);
    const geometryNamesByRoot = new Map();
    for (const f of geometryFeatures) {
      const { root, name } = f.properties;
      if (!geometryNamesByRoot.has(root)) geometryNamesByRoot.set(root, new Set());
      geometryNamesByRoot.get(root).add(name);
    }

    // Point-in-polygon against every one of this city's neighborhoods,
    // regardless of root — a DC-metro place could plausibly be
    // mis-geocoded across the Washington/Arlington/Alexandria line, and
    // that's exactly the kind of mismatch worth surfacing.
    function actualFeatureFor(point) {
      for (const f of geometryFeatures) {
        if (d3.geoContains(f, point)) return f.properties;
      }
      return null;
    }

    const cityPlaces = rows.filter((p) => isPlaceInCity(p.idPath, city.sources));
    const findings = { mismatch: [], outside: [], unmapped: [] };

    for (const place of cityPlaces) {
      const declared = resolveCityFeatureName(place, city.sources, geometryNamesByRoot, city.normalize);
      const point = [place.lng, place.lat];
      const actual = actualFeatureFor(point);

      if (declared === null && actual === null) continue; // nothing to say
      if (declared && actual && declared.root === actual.root && declared.featureName === actual.name) continue; // agrees

      const line = `  #${place.id} ${place.name} — ${place.namePath}`;
      if (declared && !actual) {
        findings.outside.push(`${line}\n    declared: ${declared.root}/${declared.featureName} — point falls in none of ${city.label}'s neighborhoods`);
      } else if (declared && actual) {
        findings.mismatch.push(`${line}\n    declared: ${declared.root}/${declared.featureName} — point actually falls in: ${actual.root}/${actual.name}`);
      } else if (!declared && actual) {
        findings.unmapped.push(`${line}\n    no declared neighborhood (name_path didn't resolve) — point falls in: ${actual.root}/${actual.name}`);
      }
    }

    const cityTotal = findings.mismatch.length + findings.outside.length + findings.unmapped.length;
    totalFlagged += cityTotal;
    console.log(`\n=== ${city.label} (${cityPlaces.length} places checked, ${cityTotal} flagged) ===`);
    if (findings.mismatch.length) {
      console.log(`\nMISMATCH (${findings.mismatch.length}):`);
      findings.mismatch.forEach((l) => console.log(l));
    }
    if (findings.outside.length) {
      console.log(`\nOUTSIDE (${findings.outside.length}):`);
      findings.outside.forEach((l) => console.log(l));
    }
    if (findings.unmapped.length) {
      console.log(`\nUNMAPPED (${findings.unmapped.length}, lower priority — likely an alias/geometry gap, not necessarily a bad coordinate):`);
      findings.unmapped.forEach((l) => console.log(l));
    }
    if (cityTotal === 0) console.log("  Nothing flagged.");
  }

  console.log(`\n${totalFlagged} place(s) flagged across ${cityKeys.length} cit${cityKeys.length === 1 ? "y" : "ies"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
