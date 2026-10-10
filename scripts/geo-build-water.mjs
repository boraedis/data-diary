/**
 * Builds the city heatmaps' water overlay (#286):
 * src/data/geo/water/<city>.topo.json, one file per city in
 * src/lib/geo/city-config.ts, plus src/data/geo/water/SOURCES.json
 * recording the exact upstream release each was built from.
 *
 * A sibling of geo-build-admin.mjs, and like it there is no committed
 * `sources/` copy: the input is published data nobody edits by hand, so
 * the upstream release *is* the source (#163's split). Only the small,
 * per-city clipped result is committed.
 *
 * ## Source: Overture Maps' base/water (OpenStreetMap)
 *
 * The first cut of #286 used Natural Earth 10m. It was cheap and painted
 * beneath the neighborhoods it mostly hid its own coarseness, but not
 * enough: at ~1km accuracy its coastline visibly disagreed with the
 * shoreline-accurate neighborhood polygons, leaving card-coloured slivers
 * along every coast, and it had no minor rivers at all (the Anacostia,
 * Dubai Creek). Rejected on review as "not super aligned with anything".
 *
 * Overture's base theme republishes OSM water — coastline-derived ocean
 * polygons plus riverbank, lake, reservoir and canal areas — at full
 * resolution, which is the same order of accuracy as the neighborhood
 * data, so the two actually meet at the shore. Licence is ODbL (OSM),
 * which requires attribution; see CITY_HEATMAP_METHODOLOGY, where the
 * chart credits it.
 *
 * It's read straight from Overture's public S3 bucket as GeoParquet, with
 * no Overture/DuckDB tooling: hyparquet reads each file's footer over
 * HTTP range requests, and every row group carries min/max statistics on
 * the `bbox` columns. Overture sorts its files spatially, so for a city
 * only a handful of the ~8,000 row groups overlap, and only those are
 * downloaded — a full build moves tens of MB, not the 28GB the layer
 * totals.
 *
 * ## What counts as water here
 *
 * Only polygons, and only the subtypes/classes in KEEP_SUBTYPES minus
 * DROP_CLASSES — see those for why. Lines are dropped: OSM maps any river
 * wide enough to see at city scale as an area as well, and the centerline
 * of one would only duplicate it (the thin ones would be invisible under
 * the neighborhood fill anyway, which is exactly where streams run).
 *
 * ## Clipping
 *
 * Every feature is clipped to the city's own bounds (taken from its
 * committed neighborhood TopoJSON) padded by PAD_FACTOR on every side.
 * The padding exists because the map is fitted to the neighborhoods but
 * the viewport rarely shares their aspect ratio, and the map can be
 * panned: water that stopped exactly at the neighborhoods' bounding box
 * would visibly end in a straight line just off the city's edge. Beyond
 * the padding it still does, but only after panning well away from
 * anything the chart is about.
 *
 * Clipping is d3's own rectangle clip (the same one `clipExtent` uses),
 * run over raw lon/lat through a y-reflected geoIdentity so it sees the
 * orientation it expects from a projected stream. It correctly closes a
 * clipped polygon along the rectangle's edge, which a naive per-ring
 * clip doesn't.
 *
 * Usage:
 *   npm run geo:build-water [city...]
 *
 * No database access at all — the input is the committed neighborhood
 * TopoJSON (for bounds) plus Overture.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { topology } from "topojson-server";
import { filter, filterWeight, presimplify, quantile, simplify } from "topojson-simplify";
import { feature, quantize } from "topojson-client";
import { OVERTURE_RELEASE, boxesOverlap, clipGeometry, fetchLayerRows } from "./lib/overture.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { WATER_TOPOLOGY_OBJECT } from "../src/lib/geo/water.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "src", "data", "geo");
const OUT_DIR = path.join(GEO_DIR, "water");
const SOURCES_FILE = path.join(OUT_DIR, "SOURCES.json");

/** Overture water subtypes drawn as water. Everything else in the layer
 * is either not water you'd see on a map (`human_made` is swimming pools
 * — 51k of NYC's 57k rows — and fountains; `physical` is point labels
 * for bays and capes; `spring`, `stream` are points/lines) or already
 * covered by an area subtype listed here. */
const KEEP_SUBTYPES = new Set(["ocean", "lake", "river", "reservoir", "canal", "water", "pond"]);

/** Classes dropped even under a kept subtype: artificial or overlay
 * polygons that are technically water but read as noise — treatment
 * plant tanks, stormwater basins, drainage ditches, and `fairway`, a
 * shipping-lane polygon drawn on top of water that's already there. */
const DROP_CLASSES = new Set(["wastewater", "basin", "drain", "ditch", "fairway", "fish_pass", "dock"]);

/** Water bodies smaller than this are dropped — a 2-hectare pond is a
 * dot at the zoom a city opens at, and hundreds of them only cost bytes. */
const MIN_AREA_M2 = 20_000;

/** The same floor for water lying wholly outside the city's own bounds
 * (in the padding only): 1km². Out there it's orientation — the sea, a
 * big lake, a wide river — not detail anyone zooms into, and rural
 * ponds in the padding were most of Istanbul's and Atlanta's bytes. */
const MIN_OUTER_AREA_M2 = 1_000_000;

const EARTH_RADIUS_M = 6_371_008.8;

/** Padding on each side of a city's bounds, as a fraction of its longer
 * side — see "Clipping" above. 0.5 is enough that a wide viewport on a
 * tall city (Atlanta) is filled at the initial zoom; full-resolution OSM
 * coastline makes every extra degree of padding cost real bytes. */
const PAD_FACTOR = 0.5;

/** Per-city ceiling on the output file. Same number geo-build-admin.mjs
 * uses for a subdivision layer; the explorer lazy-loads one city's water
 * at a time, so this is what one city switch downloads. */
const TARGET_BYTES = 150_000;

/** A city's neighborhoods, its own bounds, and the padded clip box. */
function loadCity(cityKey) {
  const topo = JSON.parse(readFileSync(path.join(GEO_DIR, `${cityKey}.topo.json`), "utf8"));
  const neighborhoods = feature(topo, topo.objects[cityKey]);
  const [[x0, y0], [x1, y1]] = d3.geoBounds(neighborhoods);
  const pad = PAD_FACTOR * Math.max(x1 - x0, y1 - y0);
  return {
    bounds: [x0, y0, x1, y1],
    clipBox: [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
    covers: buildCoverTest(neighborhoods),
  };
}

function ringBox(ring) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }
  return box;
}

/** A test for "this water is hidden under one neighborhood": true when
 * every vertex of every one of its polygons lies inside a single
 * neighborhood polygon (and outside that polygon's holes).
 *
 * Such water can never show — InteractiveGeo paints it *beneath* the
 * region fill — so it's dropped rather than shipped. In NYC and Atlanta
 * that's most park ponds and reservoirs, and it's what lets the visible
 * water keep its full detail inside the byte budget instead of being
 * simplified back into the misalignment this source exists to fix.
 *
 * Deliberately "one neighborhood", not "the union of all of them": a
 * river whose two banks each fall inside a neighborhood but whose middle
 * runs through a gap between them has every vertex covered by *some*
 * neighborhood and is still plainly visible. Requiring one containing
 * polygon can in principle keep water a non-convex neighborhood hides
 * (bytes, harmless), but can't drop water that shows. Planar lon/lat
 * containment — fine at city scale. */
function buildCoverTest(neighborhoods) {
  const polys = [];
  for (const f of neighborhoods.features) {
    const g = f.geometry;
    if (!g) continue;
    const parts = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const rings of parts) polys.push({ rings, box: ringBox(rings[0]) });
  }
  const inside = (poly, [x, y]) =>
    d3.polygonContains(poly.rings[0], [x, y]) && !poly.rings.slice(1).some((hole) => d3.polygonContains(hole, [x, y]));
  return (geometry) => {
    const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return parts.every((rings) => {
      const outer = rings[0];
      const box = ringBox(outer);
      return polys.some(
        (poly) =>
          box[0] >= poly.box[0] &&
          box[1] >= poly.box[1] &&
          box[2] <= poly.box[2] &&
          box[3] <= poly.box[3] &&
          outer.every((pt) => inside(poly, pt)),
      );
    });
  };
}

function isKept(row) {
  if (!KEEP_SUBTYPES.has(row.subtype) || DROP_CLASSES.has(row.class)) return false;
  const type = row.geometry?.type;
  return type === "Polygon" || type === "MultiPolygon";
}

/** Any polygon covering more than a hemisphere. Nothing in a city-sized
 * clip box legitimately does, so one of these is always a ring whose
 * winding flipped — and d3 draws a flipped ring as the *whole globe
 * minus that ring*, painting every bit of land on the map as water. */
function invertedFeatures(topo) {
  return feature(topo, topo.objects[WATER_TOPOLOGY_OBJECT]).features.filter((f) => d3.geoArea(f) > 2 * Math.PI);
}

/** Simplifies until the serialized topology fits TARGET_BYTES — same
 * loop as geo-build-admin.mjs's own, see there — with one addition.
 *
 * After simplifying, rings whose weight falls under the threshold are
 * *removed* (`filter`/`filterWeight`) rather than left as collapsed
 * slivers. Without it, a small pond simplified down to three nearly
 * collinear points can come out wound the wrong way, and d3 renders an
 * inverted ring as the complement of itself — that's what painted all of
 * New Jersey blue in the first build. `invertedFeatures` then checks the
 * result anyway, and the build refuses to write a file that still has
 * one. */
function buildTopology(collection) {
  const base = presimplify(topology({ [WATER_TOPOLOGY_OBJECT]: collection }, 1e6));
  let json = "";
  let kept = 1;
  for (const p of [1, 0.5, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.035, 0.025]) {
    const minWeight = p === 1 ? 0 : quantile(base, p);
    let topo = simplify(structuredClone(base), minWeight);
    topo = filter(topo, filterWeight(topo, minWeight));
    topo = quantize(topo, 1e5);
    const inverted = invertedFeatures(topo);
    if (inverted.length > 0) throw new Error(`${inverted.length} inverted water polygon(s) at ${p * 100}% of points kept`);
    json = JSON.stringify(topo);
    kept = p;
    if (json.length <= TARGET_BYTES) break;
  }
  if (json.length > TARGET_BYTES) console.warn(`    over the ${TARGET_BYTES / 1000}KB target even at 2.5% of points kept`);
  return { json, kept };
}

function buildCity(cityKey, city, rows) {
  const features = [];
  let small = 0;
  let hidden = 0;
  for (const row of rows) {
    if (!isKept(row)) continue;
    const clipped = clipGeometry(row.geometry, city.clipBox);
    if (!clipped) continue;
    const rowBox = [row.bbox.xmin, row.bbox.ymin, row.bbox.xmax, row.bbox.ymax];
    const outside = !boxesOverlap(rowBox, city.bounds);
    if (d3.geoArea(clipped) * EARTH_RADIUS_M ** 2 < (outside ? MIN_OUTER_AREA_M2 : MIN_AREA_M2)) {
      small++;
      continue;
    }
    if (city.covers(clipped)) {
      hidden++;
      continue;
    }
    // Only `kind` survives into the output. The overlay is decorative
    // and non-interactive (see InteractiveGeo's `contextFeatures`), so
    // names/ids would be bytes nothing reads.
    features.push({ type: "Feature", properties: { kind: "area" }, geometry: clipped });
  }
  const { json, kept } = buildTopology({ type: "FeatureCollection", features });
  writeFileSync(path.join(OUT_DIR, `${cityKey}.topo.json`), json);
  console.log(
    `  [${cityKey}] ${features.length} water bodies (${small} too small, ${hidden} hidden under a neighborhood), ` +
      `${Math.round(kept * 100)}% of points kept -> ${cityKey}.topo.json (${(json.length / 1000).toFixed(1)}KB)`,
  );
  return { features: features.length, pointsKept: kept };
}

async function main() {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((c) => !(c in CITIES));
  if (unknown.length > 0) {
    console.error(`Unknown city key(s): ${unknown.join(", ")}. Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  const cityKeys = requested.length > 0 ? requested : Object.keys(CITIES);
  const cities = cityKeys.map(loadCity);
  const boxes = cities.map((c) => c.clipBox);

  console.log(`Reading Overture ${OVERTURE_RELEASE} base/water...`);
  const rowsPerCity = await fetchLayerRows({
    theme: "base",
    type: "water",
    columns: ["subtype", "class", "geometry"],
    boxes,
    // Dropped as each row is read, not after: most of the layer (NYC's
    // swimming pools, alone) is water that is never drawn.
    keep: isKept,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : {};
  console.log("Building water TopoJSON:");
  cityKeys.forEach((cityKey, i) => {
    const built = buildCity(cityKey, cities[i], rowsPerCity[i]);
    sources[cityKey] = {
      source: "Overture Maps base/water (OpenStreetMap)",
      license: "ODbL 1.0",
      licenseSource: "https://docs.overturemaps.org/attribution/",
      release: OVERTURE_RELEASE,
      clipBox: boxes[i].map((v) => Number(v.toFixed(4))),
      waterBodies: built.features,
      pointsKept: built.pointsKept,
    };
  });
  const sorted = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
  writeFileSync(SOURCES_FILE, JSON.stringify(sorted, null, 2) + "\n");
}

await main();
