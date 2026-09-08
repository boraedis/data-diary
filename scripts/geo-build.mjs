/**
 * Rebuilds every #177 city-heatmap TopoJSON file
 * (src/data/geo/*.topo.json) from its own editable GeoJSON source(s)
 * (src/data/geo/sources/*.geojson).
 *
 * This is the "how do these stay maintained" half of #265 — the
 * committed .topo.json files are a build artifact, never hand-edited
 * directly. The actual editable geometry lives in sources/ as plain
 * GeoJSON (small diffs, human-readable, easy to open in geojson.io or
 * any GIS tool); this script is what turns a source edit into the
 * simplified, topology-deduped file the chart actually imports. Re-run
 * it after any sources/ edit — see scripts/geo-add-feature.mjs for how a
 * single neighborhood's polygon typically gets added/redrawn in the
 * first place.
 *
 * Per city, this also cross-checks every real catalog neighborhood name
 * (from the live places table) against the geometry + its
 * normalize<City>Name alias table (src/lib/geo/*-names.ts), and warns
 * about any catalog neighborhood that still won't resolve to a polygon —
 * catching a typo'd alias or a genuinely uncovered neighborhood (like
 * Dubai's real, documented gaps — see dubai-names.ts) before it's a
 * silent "no data" region on the actual chart.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/geo-build.mjs [city...]
 *
 * With no city arguments, rebuilds all of them. Read-only against the
 * database (only SELECTs, for the name cross-check) — safe to run
 * anytime, including against prod, no guardAgainstProd needed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import { quantize } from "topojson-client";
import { fixWinding } from "./lib/geo-winding.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { resolveCityFeatureName } from "../src/lib/geo/resolve-city-place.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "src", "data", "geo");
const SOURCES_DIR = path.join(GEO_DIR, "sources");

function loadCitySource(cityKey, city) {
  const features = [];
  for (const source of city.sources) {
    const raw = JSON.parse(readFileSync(path.join(SOURCES_DIR, source.sourceFile), "utf8"));
    for (const feature of raw.features) {
      features.push({
        ...feature,
        geometry: fixWinding(feature.geometry),
        properties: { ...feature.properties, root: source.root },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

async function checkCatalogCoverage(cityKey, city, pool) {
  const rootIds = city.sources.map((s) => s.rootId);
  const { rows: rootRows } = await pool.query("SELECT id, name FROM places WHERE id = ANY($1)", [rootIds]);
  const rootNameById = new Map(rootRows.map((r) => [r.id, r.name]));
  const missingRoots = city.sources.filter((s) => !rootNameById.has(s.rootId));
  if (missingRoots.length > 0) {
    console.warn(
      `  [${cityKey}] configured rootId(s) not found in the catalog: ${missingRoots
        .map((s) => `${s.root}=${s.rootId}`)
        .join(", ")} — city-config.ts's rootId is probably stale, see its own comment`,
    );
  }
  if (rootNameById.size === 0) return;

  // Geometry names scoped per root — DC-metro must not let an Arlington
  // neighborhood satisfy a Washington-rooted place just because the
  // names happen to collide.
  const geometryNamesByRoot = new Map();
  for (const source of city.sources) {
    const raw = JSON.parse(readFileSync(path.join(SOURCES_DIR, source.sourceFile), "utf8"));
    geometryNamesByRoot.set(source.root, new Set(raw.features.map((f) => f.properties.name)));
  }

  const { rows: allPlaces } = await pool.query("SELECT id, parent_id, name_path, id_path FROM places");
  const hasChildren = new Set(allPlaces.map((p) => p.parent_id).filter((id) => id != null));

  let uncovered = 0;
  let checked = 0;
  for (const place of allPlaces) {
    if (hasChildren.has(place.id)) continue; // only leaves are ever "the thing that needs a polygon"
    if (!place.id_path || !place.name_path) continue;
    // Skip a leaf that IS one of this city's own roots (namePath has no
    // segments left after it) — resolveCityFeatureName correctly returns
    // null for that (a root has no single feature it maps to), but that's
    // not a coverage gap worth warning about.
    const idSegments = place.id_path.split("/").filter(Boolean);
    const isBareRoot = city.sources.some((s) => idSegments.at(-1) === String(s.rootId));
    if (isBareRoot) continue;

    const resolved = resolveCityFeatureName(
      { idPath: place.id_path, namePath: place.name_path },
      city.sources,
      geometryNamesByRoot,
      city.normalize,
    );
    const inThisCity = city.sources.some((s) => idSegments.includes(String(s.rootId)));
    if (!inThisCity) continue;
    checked++;
    if (!resolved) {
      console.warn(`  [${cityKey}] "${place.name_path}" doesn't resolve to any geometry feature`);
      uncovered++;
    }
  }
  if (checked === 0) {
    console.log(`  [${cityKey}] no catalog entries found under ${[...rootNameById.values()].join("/")}`);
  } else if (uncovered === 0) {
    console.log(`  [${cityKey}] all ${checked} catalog entries under ${[...rootNameById.values()].join("/")} resolve`);
  }
}

function buildCity(cityKey, city) {
  const collection = loadCitySource(cityKey, city);
  // 1e6, not a boolean — topology()'s quantization argument wants a
  // number (typically a power of ten), not a truthy flag. Passing `true`
  // silently coerces into nonsense internally and produced NaN
  // coordinates on every simplified arc, caught only by actually
  // rendering the output (see geo-winding.mjs's own comment on why this
  // class of bug doesn't show up in tsc/eslint). 1e6 is fine-grained
  // enough that no city-scale neighborhood boundary visibly snaps to a
  // grid.
  let topo = topology({ [cityKey]: collection }, 1e6);
  topo = presimplify(topo);
  // Deliberately conservative threshold — coordinates are raw lon/lat
  // degrees (unprojected), so this is only dropping near-collinear
  // micro-vertices, not visibly changing any neighborhood's shape. No
  // #266 consumer chart exists yet to visually confirm against, so
  // erring toward "barely simplifies" over "might distort a shape
  // nobody's looked at yet" — revisit this number once there's a real
  // render to check it against.
  topo = simplify(topo, 1e-10);
  // simplify() strips the delta-encoded transform (see its own docs,
  // quoted above) — re-quantize afterward or every arc ships as
  // absolute floating-point coordinate pairs instead of TopoJSON's
  // actual space-saving format. This is most of this pipeline's real
  // size reduction, not the simplify() step itself.
  topo = quantize(topo, 1e5);

  const outFile = `${cityKey}.topo.json`;
  writeFileSync(path.join(GEO_DIR, outFile), JSON.stringify(topo));
  console.log(`  [${cityKey}] ${collection.features.length} features -> ${outFile}`);
}

async function main() {
  const requested = process.argv.slice(2);
  const cityKeys = requested.length > 0 ? requested : Object.keys(CITIES);
  for (const key of cityKeys) {
    if (!CITIES[key]) {
      console.error(`Unknown city "${key}". Known: ${Object.keys(CITIES).join(", ")}`);
      process.exit(1);
    }
  }

  console.log("Building TopoJSON:");
  for (const key of cityKeys) {
    buildCity(key, CITIES[key]);
  }

  if (!process.env.DATABASE_URL) {
    console.log("\nSet DATABASE_URL to also cross-check catalog coverage.");
    return;
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  console.log("\nChecking catalog coverage:");
  for (const key of cityKeys) {
    await checkCatalogCoverage(key, CITIES[key], pool);
  }
  await pool.end();
}

main();
