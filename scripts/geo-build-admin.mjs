/**
 * Builds the world map's per-country subdivision geometry (#304):
 * src/data/geo/admin/<iso3>.topo.json, one file per entry in
 * src/lib/geo/admin-regions.ts, plus src/data/geo/admin/SOURCES.json
 * recording where each one came from and under what licence.
 *
 * The sibling of geo-build.mjs, with one deliberate difference: there is
 * no committed `sources/` GeoJSON here. The city heatmaps' sources are
 * hand-edited (neighbourhood polygons redrawn by geo-add-feature.mjs), so
 * the editable form has to live in the repo. These are published national
 * boundaries nobody edits by hand — the upstream file *is* the source, and
 * committing a raw copy (several MB for some countries) would only add
 * weight to .git for no edit history worth having. This script downloads
 * it fresh instead, and SOURCES.json pins the exact upstream commit each
 * committed file was built from.
 *
 * Downloads geoBoundaries' pre-simplified GeoJSON, then simplifies further
 * until each country's file fits under TARGET_BYTES: the full-resolution
 * layers run to tens of MB (legacy committed a 25MB Spain), and a
 * province only needs to be recognisable at the zoom a click lands on.
 *
 * With DATABASE_URL set, also cross-checks the catalog: which countries
 * have logged days but no entry in admin-regions.ts (worth adding), and
 * per configured country how many geocoded places resolve to no
 * subdivision at all (a bad geocode, or simplification shaving off a
 * coastline a point sits on — see admin-lookup.ts's ancestor fallback).
 * Read-only against the database, same as geo-build.mjs.
 *
 * Usage:
 *   npm run geo:build-admin [iso3...]
 *   DATABASE_URL=postgres://... npm run geo:build-admin
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";
import { feature, quantize } from "topojson-client";
import * as d3 from "d3";
import { fixWinding } from "./lib/geo-winding.mjs";
import { ADMIN_REGIONS, ADMIN_TOPOLOGY_OBJECT } from "../src/lib/geo/admin-regions.ts";
import { normalizeCountryName } from "../src/lib/geo/country-names.ts";
import { resolveAdminRegion } from "../src/lib/geo/admin-lookup.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data", "geo", "admin");
const SOURCES_FILE = path.join(OUT_DIR, "SOURCES.json");

/** Per-country ceiling. The US state layer the world map already lazy
 * loads is ~115KB; a subdivision layer a click has to wait for shouldn't
 * be much heavier than that. */
const TARGET_BYTES = 150_000;

/** Retried because GitHub's raw-file redirects (where every geoBoundaries
 * download actually lives) drop the odd connection mid-transfer, and one
 * flaky socket shouldn't abort a 26-country build. */
async function fetchJson(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

/** Islands smaller than this fraction of their country's total area are
 * dropped before simplifying. Simplification alone can't shrink a layer
 * like Canada's: every one of its thousands of Arctic islets is a ring
 * that keeps a minimum of four points however hard it's simplified, so
 * the file stays at megabytes. At 1e-5 of the country, the cut is ~100km²
 * for Canada but ~0.1km² for the Bahamas — relative, so a small island
 * nation keeps its islands. The largest polygon of every region is always
 * kept whatever its size, so no region can vanish. */
const MIN_ISLAND_FRACTION = 1e-5;

function dropSpecks(collection) {
  const total = d3.geoArea(collection);
  const min = total * MIN_ISLAND_FRACTION;
  let dropped = 0;
  const features = collection.features.map((f) => {
    if (f.geometry.type !== "MultiPolygon") return f;
    const areas = f.geometry.coordinates.map((poly) => d3.geoArea({ type: "Polygon", coordinates: poly }));
    const largest = areas.indexOf(Math.max(...areas));
    const kept = f.geometry.coordinates.filter((_, i) => i === largest || areas[i] >= min);
    dropped += f.geometry.coordinates.length - kept.length;
    return { ...f, geometry: kept.length === 1 ? { type: "Polygon", coordinates: kept[0] } : { type: "MultiPolygon", coordinates: kept } };
  });
  return { collection: { ...collection, features }, dropped };
}

/**
 * geoBoundaries' features, reduced to `{ name }` and keyed by it.
 *
 * Same-named features are merged into one MultiPolygon rather than kept
 * apart: some layers split one unit into several features (an island
 * group, an exclave), and two polygons sharing a name would be two map
 * regions sharing one day count — and the join keys by name.
 */
function toFeatureCollection(raw, config) {
  const byName = new Map();
  for (const f of raw.features) {
    let name = String(f.properties.shapeName ?? "").trim();
    if (config.dropSuffix && name.endsWith(config.dropSuffix)) name = name.slice(0, -config.dropSuffix.length);
    name = config.rename?.[name] ?? name;
    if (!name || !f.geometry) continue;
    const geometry = fixWinding(f.geometry);
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const existing = byName.get(name);
    if (existing) existing.push(...polygons);
    else byName.set(name, [...polygons]);
  }
  return {
    type: "FeatureCollection",
    features: [...byName].map(([name, polygons]) => ({
      type: "Feature",
      id: name,
      properties: { name },
      geometry: polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons },
    })),
  };
}

/** Simplifies until the serialized topology fits TARGET_BYTES, keeping as
 * much detail as that allows. `quantile(topo, p)` is the minimum weight
 * that *retains* the top fraction p of points (not drops it — easy to
 * read backwards), so walking p downward sheds the least significant
 * points first. */
function buildTopology(collection) {
  const base = presimplify(topology({ [ADMIN_TOPOLOGY_OBJECT]: collection }, 1e6));
  let json = "";
  let kept = 1;
  for (const p of [1, 0.5, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.035, 0.025]) {
    json = JSON.stringify(quantize(simplify(structuredClone(base), p === 1 ? 0 : quantile(base, p)), 1e5));
    kept = p;
    if (json.length <= TARGET_BYTES) break;
  }
  // Below ~2.5% a province stops being recognisable; ship it over budget
  // and say so rather than simplify it into a blob.
  if (json.length > TARGET_BYTES) console.warn(`    over the ${TARGET_BYTES / 1000}KB target even at 2.5% of points kept`);
  return { json, kept };
}

async function buildCountry(worldId, config, sources) {
  const meta = await fetchJson(`https://www.geoboundaries.org/api/current/${config.release ?? "gbOpen"}/${config.iso3}/${config.level}/`);
  const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  const raw = await fetchJson(url);
  const { collection, dropped: specks } = dropSpecks(toFeatureCollection(raw, config));
  const { json, kept } = buildTopology(collection);
  const outFile = `${config.iso3.toLowerCase()}.topo.json`;
  writeFileSync(path.join(OUT_DIR, outFile), json);
  sources[config.iso3] = {
    worldAtlasId: worldId,
    release: config.release ?? "gbOpen",
    level: config.level,
    units: collection.features.length,
    boundaryID: meta.boundaryID,
    canonical: meta.boundaryCanonical,
    source: meta.boundarySource,
    license: meta.boundaryLicense,
    licenseSource: meta.licenseSource,
    downloadedFrom: url,
  };
  console.log(
    `  [${config.iso3}] ${collection.features.length} ${config.unitLabel} -> ${outFile} (${Math.round(json.length / 1024)}KB, kept ${Math.round(kept * 1000) / 10}% of points, dropped ${specks} islets)`,
  );
}

/** Resolves the way getAdminRegionVisitData does — the same
 * resolveAdminRegion, fed the same points (own first, then each
 * ancestor's, the country's own excluded) — so what this reports is what
 * the page will show. Geometry is read from disk rather than through
 * admin-geometry.ts's loaders, which are bundler `import()`s. */
async function checkCatalog(pool) {
  const { rows: dayRows } = await pool.query(
    "SELECT date::text AS date, place_1_id, place_2_id FROM days WHERE place_1_id IS NOT NULL OR place_2_id IS NOT NULL",
  );
  const { rows: places } = await pool.query("SELECT id, name, parent_id, id_path, lat, lng FROM places");
  const byId = new Map(places.map((p) => [p.id, p]));
  const worldTopo = JSON.parse(readFileSync(path.join(__dirname, "..", "node_modules", "world-atlas", "countries-50m.json"), "utf8"));
  const worldIdByName = new Map(worldTopo.objects.countries.geometries.map((g) => [g.properties.name, g.id]));

  const regionsByWorldId = new Map();
  for (const [worldId, config] of Object.entries(ADMIN_REGIONS)) {
    const file = path.join(OUT_DIR, `${config.iso3.toLowerCase()}.topo.json`);
    if (!existsSync(file)) continue;
    const topo = JSON.parse(readFileSync(file, "utf8"));
    regionsByWorldId.set(worldId, feature(topo, topo.objects[ADMIN_TOPOLOGY_OBJECT]).features);
  }

  const daysByCountry = new Map();
  const unresolvedByCountry = new Map();
  const unresolvedPlaces = new Map();
  for (const d of dayRows) {
    for (const pid of [d.place_1_id, d.place_2_id]) {
      const place = pid == null ? null : byId.get(pid);
      if (!place?.id_path) continue;
      const ids = place.id_path.split("/").filter(Boolean).map(Number);
      const root = byId.get(ids[0]);
      const worldId = root ? worldIdByName.get(normalizeCountryName(root.name)) : undefined;
      if (!worldId || worldId === "840") continue;
      const key = `${worldId}\0${root.name}`;
      (daysByCountry.get(key) ?? daysByCountry.set(key, new Set()).get(key)).add(d.date);
      const regions = regionsByWorldId.get(worldId);
      if (!regions) continue;
      const points = ids
        .slice(1)
        .reverse()
        .map((id) => byId.get(id))
        .filter((p) => p?.lat != null && p?.lng != null)
        .map((p) => [p.lng, p.lat]);
      if (!resolveAdminRegion(regions, points)) {
        (unresolvedByCountry.get(key) ?? unresolvedByCountry.set(key, new Set()).get(key)).add(d.date);
        unresolvedPlaces.set(place.id, place);
      }
    }
  }

  const unconfigured = [...daysByCountry].filter(([key]) => !regionsByWorldId.has(key.split("\0")[0]));
  if (unconfigured.length > 0) {
    console.log("\nCountries with logged days but no subdivision geometry (add them to admin-regions.ts):");
    for (const [key, ds] of unconfigured) console.log(`  ${key.split("\0")[1]} (world-atlas ${key.split("\0")[0]}): ${ds.size} days`);
  } else {
    console.log("\nEvery country with logged days has subdivision geometry.");
  }
  if (unresolvedByCountry.size > 0) {
    console.log("\nDays that land in no subdivision (bad geocode, or a coastline lost to simplification):");
    for (const [key, ds] of unresolvedByCountry) console.log(`  ${key.split("\0")[1]}: ${ds.size} days`);
    for (const p of unresolvedPlaces.values()) console.log(`    place ${p.id} "${p.name}" (${p.lat}, ${p.lng})`);
  } else {
    console.log("Every logged day in a configured country resolves to a subdivision.");
  }
}

async function main() {
  const requested = process.argv.slice(2).map((s) => s.toUpperCase());
  const entries = Object.entries(ADMIN_REGIONS).filter(([, c]) => requested.length === 0 || requested.includes(c.iso3));
  if (requested.length > 0 && entries.length !== requested.length) {
    console.error(`Unknown ISO3 code(s). Known: ${Object.values(ADMIN_REGIONS).map((c) => c.iso3).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : {};
  console.log("Building admin TopoJSON:");
  for (const [worldId, config] of entries) await buildCountry(worldId, config, sources);
  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(SOURCES_FILE, JSON.stringify(sorted, null, 2) + "\n");

  if (!process.env.DATABASE_URL) {
    console.log("\nSet DATABASE_URL to also cross-check catalog coverage.");
    return;
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await checkCatalog(pool);
  await pool.end();
}

main();
