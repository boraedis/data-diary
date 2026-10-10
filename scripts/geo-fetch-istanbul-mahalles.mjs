/**
 * Rebuilds src/data/geo/sources/istanbul.geojson as Istanbul's mahalles
 * (neighborhoods, OSM admin_level=8) instead of its ilçes (districts,
 * admin_level=6), from OpenStreetMap via Overpass. Run
 * `npm run geo:build istanbul` afterwards to fold it into the committed
 * istanbul.topo.json.
 *
 * ## Why mahalles
 *
 * The first Istanbul layer (#265) was the 39 districts, because that was
 * the grain the catalog's first entries were typed at. But the catalog's
 * second level is the mahalle (Cihangir, Bebek, Emirgan...), the same grain
 * Atlanta, DC and NYC are drawn at, and a district is the size of a whole
 * city elsewhere on this map. ~960 mahalles is a lot of polygons, which is
 * why the pipeline simplifies them as one topology below and why the map's
 * name labels only appear once a polygon is large enough to hold one.
 *
 * ## Naming
 *
 * OSM names every one "<Name> Mahallesi"; the suffix is dropped, since it
 * is the same on all of them and the catalog never writes it. Mahalle names
 * repeat across districts (there are dozens of "Cumhuriyet"), so a name
 * that occurs more than once, or that is also a district's name, is written
 * "Name (District)" in the geometry.
 * resolveCityFeatureName tries that qualified form first, using the
 * catalog segment above the mahalle (the district), before the bare name.
 * Each feature also carries its `district`, for the tooltip.
 *
 * The district is found by spatial join against the admin_level=6
 * relations fetched in the same query: the district holding most of a
 * mahalle's boundary vertices (a mahalle's centroid can sit outside it when
 * it curves around a bay).
 *
 * ## Assembly
 *
 * Overpass returns a relation as loose ways, not polygons. Ways are joined
 * end to end into closed rings (see assembleRings), inner rings are dropped
 * into the outer ring containing them, and a relation whose ways don't
 * close is reported and skipped rather than drawn wrong.
 *
 * Usage:
 *   npm run geo:fetch-istanbul-mahalles [-- --cache=/tmp/istanbul-osm.json]
 *
 * `--cache` saves the raw Overpass answer there on the first run and reads
 * it on later ones, for iterating on simplification without refetching
 * ~50MB. Network only, no database. Data © OpenStreetMap contributors
 * (ODbL); the chart's methodology text carries the attribution.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import { feature } from "topojson-client";
import { fixWinding } from "./lib/geo-winding.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "..", "src", "data", "geo", "sources", "istanbul.geojson");

const OVERPASS = "https://overpass-api.de/api/interpreter";
const QUERY = `[out:json][timeout:240];
area["name"="İstanbul"]["admin_level"="4"]->.a;
rel(area.a)["boundary"="administrative"]["admin_level"~"^(6|8)$"];
out geom;`;

// presimplify's planar weight over raw lon/lat, as in geo-fetch-suburbs.mjs
// (minimum triangle area, in square degrees, a vertex must carry). Picked by
// size: the committed file should stay near the other cities' ~250-300KB
// even with ~25x the polygons.
const SIMPLIFY_WEIGHT = 1e-7;

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Joins ways (arrays of [lon, lat]) into closed rings. Returns
 * { rings, open } — `open` counts ways that never closed. */
function assembleRings(ways) {
  const pool = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const rings = [];
  let open = 0;
  while (pool.length > 0) {
    let ring = pool.pop();
    let grew = true;
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const head = ring[0];
        const tail = ring[ring.length - 1];
        if (same(tail, w[0])) ring = ring.concat(w.slice(1));
        else if (same(tail, w[w.length - 1])) ring = ring.concat(w.slice(0, -1).reverse());
        else if (same(head, w[w.length - 1])) ring = w.slice(0, -1).concat(ring);
        else if (same(head, w[0])) ring = w.slice(1).reverse().concat(ring);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
    else open++;
  }
  return { rings, open };
}

/** Planar point-in-ring (ray casting) — winding-independent. */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** An OSM boundary relation as a GeoJSON MultiPolygon, or null if its
 * outer ways don't close. */
function relationGeometry(rel) {
  const wayCoords = (role) =>
    rel.members
      .filter((m) => m.type === "way" && m.role === role && m.geometry)
      .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const outers = assembleRings(wayCoords("outer"));
  if (outers.rings.length === 0 || outers.open > 0) return null;
  // An unclosed inner ring (a hole) is dropped quietly rather than costing
  // the whole polygon.
  const inners = assembleRings(wayCoords("inner")).rings;

  const polygons = outers.rings.map((ring) => [ring]);
  for (const hole of inners) {
    // Planar test on purpose: these rings have OSM's arbitrary winding, and
    // d3.geoContains reads winding as which side of the ring is inside.
    const owner = polygons.find((p) => inRing(hole[0], p[0]));
    if (owner) owner.push(hole);
  }
  return fixWinding({ type: "MultiPolygon", coordinates: polygons });
}

async function loadOverpass(cachePath) {
  if (cachePath && existsSync(cachePath)) {
    console.log(`reading ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  console.log("querying Overpass (large; this takes a minute)...");
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "data-diary-geo/1.0 (personal project)" },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!res.ok) throw new Error(`Overpass: HTTP ${res.status}`);
  const text = await res.text();
  if (cachePath) writeFileSync(cachePath, text);
  return JSON.parse(text);
}

/** The district holding the most of a mahalle's boundary vertices. */
function districtOf(geometry, districts) {
  const votes = new Map();
  const points = geometry.coordinates.flatMap((p) => p[0]);
  const step = Math.max(1, Math.floor(points.length / 40));
  for (let i = 0; i < points.length; i += step) {
    const hit = districts.find((d) => d.contains(points[i]));
    if (hit) votes.set(hit.name, (votes.get(hit.name) ?? 0) + 1);
  }
  let best = null;
  for (const [name, n] of votes) if (!best || n > best.n) best = { name, n };
  return best?.name ?? null;
}

async function main() {
  const cacheArg = process.argv.find((a) => a.startsWith("--cache="));
  const raw = await loadOverpass(cacheArg ? cacheArg.slice("--cache=".length) : null);
  const relations = raw.elements.filter((e) => e.type === "relation");

  const districts = [];
  const mahalles = [];
  const skipped = [];
  for (const rel of relations) {
    const level = rel.tags?.admin_level;
    const geometry = relationGeometry(rel);
    const name = rel.tags?.name;
    if (!geometry || !name) {
      skipped.push(`${level}:${name ?? rel.id}`);
      continue;
    }
    if (level === "6") {
      const feat = { type: "Feature", properties: {}, geometry };
      districts.push({ name, contains: (pt) => d3.geoContains(feat, pt) });
    } else {
      mahalles.push({ name: name.replace(/\s+Mahallesi$/u, "").trim(), geometry, id: rel.id });
    }
  }
  console.log(`${districts.length} districts, ${mahalles.length} mahalles, ${skipped.length} skipped`);
  if (skipped.length > 0) console.log(`  skipped (ways don't close): ${skipped.join(", ")}`);

  const tagged = mahalles.map((m) => ({ ...m, district: districtOf(m.geometry, districts) }));
  const noDistrict = tagged.filter((m) => !m.district);
  if (noDistrict.length > 0) console.log(`  no district found for: ${noDistrict.map((m) => m.name).join(", ")}`);

  // A name that repeats anywhere in the city is qualified by its district;
  // see this file's header. So is a mahalle that shares its name with a
  // *district* (Arnavutköy the Beşiktaş mahalle, Fatih...): the catalog's
  // district segment sits above its mahalle and is checked first, so a bare
  // "Arnavutköy" feature would swallow every place in the Arnavutköy
  // district whose own mahalle isn't matched.
  const counts = new Map();
  for (const m of tagged) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  const districtNames = new Set(districts.map((d) => d.name));
  const features = tagged.map((m) => ({
    type: "Feature",
    properties: {
      name: (counts.get(m.name) > 1 || districtNames.has(m.name)) && m.district ? `${m.name} (${m.district})` : m.name,
      ...(m.district ? { district: m.district } : {}),
    },
    geometry: m.geometry,
  }));
  const seen = new Set();
  for (const f of features) {
    if (seen.has(f.properties.name)) throw new Error(`still duplicated after qualifying: ${f.properties.name}`);
    seen.add(f.properties.name);
  }
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, "tr"));

  let topo = presimplify(topology({ istanbul: { type: "FeatureCollection", features } }, 1e6));
  topo = simplify(topo, SIMPLIFY_WEIGHT);
  const simplified = feature(topo, topo.objects.istanbul).features.map(({ properties, geometry }) => ({
    type: "Feature",
    properties,
    geometry,
  }));

  // One feature per line: a hand edit or a re-fetch diffs by neighborhood,
  // and the file stays a fraction of the size indenting every coordinate
  // would make it.
  const lines = simplified.map((f) => JSON.stringify(f)).join(",\n");
  writeFileSync(OUT_FILE, `{"type":"FeatureCollection","features":[\n${lines}\n]}\n`);
  console.log(`-> ${path.relative(process.cwd(), OUT_FILE)} (${simplified.length} features)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
