/**
 * Builds the city heatmaps' water overlay (#286):
 * src/data/geo/water/<city>.topo.json, one file per city in
 * src/lib/geo/city-config.ts, plus src/data/geo/water/SOURCES.json
 * recording the exact upstream commit and layers they came from.
 *
 * A sibling of geo-build-admin.mjs, and like it there is no committed
 * `sources/` copy: the input is published data nobody edits by hand, so
 * the upstream file *is* the source (#163's split). Only the small,
 * per-city clipped result is committed.
 *
 * ## Why Natural Earth 10m, and why that's good enough here
 *
 * #286 had to pick between hand-tracing water per city and clipping a
 * published layer. Natural Earth (public domain, no attribution
 * required) won because of how the layer is drawn, not because it's
 * detailed — at 1:10m it plainly isn't: its coastline is ~1km-accurate,
 * and its rivers are the major ones only (the Chattahoochee, the
 * Potomac, the Passaic, Thrace's rivers around Istanbul; none at all
 * around Dubai).
 *
 * That coarseness mostly doesn't show, because the overlay is painted
 * *underneath* the neighborhood fill. The neighborhood polygons are
 * already shoreline-accurate (NYC's and DC's are carved around their
 * rivers), so wherever Natural Earth's water overshoots onto land it's
 * simply covered, and the blue only shows through the real gaps the
 * neighborhood data already leaves — New York Harbor, Jamaica Bay, the
 * Bosphorus, the Potomac between DC and Arlington, the Gulf off Dubai.
 * Where it undershoots, the gap stays the card background, as it was
 * before this overlay existed. Hand-traced water would be sharper only
 * in places the choropleth already hides.
 *
 * Its real limit is small inland water: the Anacostia, Dubai Creek and
 * the Chattahoochee's tributaries aren't in the layer at all, so those
 * gaps stay card-coloured. Closing them would mean a finer source (OSM
 * water polygons), which is the upgrade path if this ever feels thin —
 * the component and file layout here don't depend on which source
 * produced the geometry.
 *
 * ## Clipping
 *
 * Every layer is clipped to the city's own bounds (taken from its
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
 * clip doesn't — the ocean here is one polygon spanning the planet.
 *
 * Usage:
 *   npm run geo:build-water [city...]
 *
 * No database access at all — the input is the committed neighborhood
 * TopoJSON (for bounds) plus Natural Earth.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import { feature, quantize } from "topojson-client";
import { fixWinding } from "./lib/geo-winding.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { WATER_TOPOLOGY_OBJECT } from "../src/lib/geo/water.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "src", "data", "geo");
const OUT_DIR = path.join(GEO_DIR, "water");
const SOURCES_FILE = path.join(OUT_DIR, "SOURCES.json");

/** nvkelso/natural-earth-vector commit the committed files were built
 * from. Pinned rather than `master` so a rebuild is reproducible and
 * SOURCES.json can say exactly what's in the repo; bump it deliberately
 * to pick up an upstream fix. */
const NATURAL_EARTH_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19";
const NATURAL_EARTH_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson`;

/** Area layers, drawn as filled water. The regional `_north_america` /
 * `_europe` layers are Natural Earth's supplements to the global one —
 * extra, smaller features, not duplicates of it — so all three are
 * wanted. The ocean layer includes seas, bays and estuaries (New York
 * Harbor, the Bosphorus, the tidal Potomac up to DC). */
const AREA_LAYERS = ["ne_10m_ocean", "ne_10m_lakes", "ne_10m_lakes_north_america", "ne_10m_lakes_europe"];

/** Line layers, drawn as stroked rivers. Same global + supplements split. */
const LINE_LAYERS = ["ne_10m_rivers_lake_centerlines", "ne_10m_rivers_north_america", "ne_10m_rivers_europe"];

/** Padding on each side of a city's bounds, as a fraction of its longer
 * side — see "Clipping" above. 1 means the clip box is three times the
 * city's extent in each direction, enough that even a very wide viewport
 * on a tall city (Atlanta) is filled at the initial zoom. */
const PAD_FACTOR = 1;

/** Retried for the same reason geo-build-admin.mjs retries: GitHub's raw
 * endpoint drops the odd connection mid-transfer on multi-MB files. */
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

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** A GeoJSON geometry clipped to [x0, y0, x1, y1] in lon/lat, or null if
 * nothing of it falls inside.
 *
 * d3's clip emits a polygon as a flat run of rings without saying which
 * are holes, so they're re-grouped here by winding: after `fixWinding`
 * every exterior is clockwise in lon/lat and every hole counterclockwise
 * (d3's spherical convention — see geo-winding.mjs), and clipping
 * preserves orientation. Each hole is then attached to the exterior that
 * contains it. */
function clipGeometry(geometry, [x0, y0, x1, y1]) {
  // reflectY so the clip sees screen orientation (y down), which is what
  // its rectangle-corner containment test assumes; the extent is given in
  // that reflected space, and every point is flipped back on the way out.
  const clipper = d3.geoIdentity().reflectY(true).clipExtent([[x0, -y1], [x1, -y0]]);
  const rings = [];
  const lines = [];
  let current = null;
  let inPolygon = false;
  const sink = {
    point(x, y) {
      current.push([x, -y]);
    },
    lineStart() {
      current = [];
    },
    lineEnd() {
      if (inPolygon) rings.push(current);
      else if (current.length > 1) lines.push(current);
      current = null;
    },
    polygonStart() {
      inPolygon = true;
    },
    polygonEnd() {
      inPolygon = false;
    },
    sphere() {},
  };
  d3.geoStream({ type: "Feature", geometry: fixWinding(geometry), properties: {} }, clipper.stream(sink));

  if (lines.length > 0) return { type: "MultiLineString", coordinates: lines };
  if (rings.length === 0) return null;

  // d3's clip emits rings unclosed; GeoJSON wants first === last.
  const closed = rings
    .filter((r) => r.length >= 3)
    .map((r) => (r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : [...r, r[0]]));
  const exteriors = closed.filter((r) => signedArea(r) < 0);
  const holes = closed.filter((r) => signedArea(r) > 0);
  if (exteriors.length === 0) return null;
  const polygons = exteriors.map((r) => [r]);
  for (const hole of holes) {
    const owner = polygons.find(([ext]) => d3.polygonContains(ext, hole[0]));
    // A hole with no exterior around it can only be a sliver the clip cut
    // loose from its polygon; dropping it can't remove any water.
    owner?.push(hole);
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

/** Planar bbox test before clipping — cheap, and skips the ~1,400
 * river features nowhere near a given city. */
function overlaps(geometry, [x0, y0, x1, y1]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  return !(maxX < x0 || minX > x1 || maxY < y0 || minY > y1);
}

function cityClipBox(cityKey) {
  const topo = JSON.parse(readFileSync(path.join(GEO_DIR, `${cityKey}.topo.json`), "utf8"));
  const [[x0, y0], [x1, y1]] = d3.geoBounds(feature(topo, topo.objects[cityKey]));
  const pad = PAD_FACTOR * Math.max(x1 - x0, y1 - y0);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function buildCity(cityKey, layers) {
  const box = cityClipBox(cityKey);
  const features = [];
  const counts = { area: 0, line: 0 };
  for (const [layer, kind] of [
    ...AREA_LAYERS.map((l) => [l, "area"]),
    ...LINE_LAYERS.map((l) => [l, "line"]),
  ]) {
    for (const f of layers[layer].features) {
      if (!f.geometry || !overlaps(f.geometry, box)) continue;
      const clipped = clipGeometry(f.geometry, box);
      if (!clipped) continue;
      counts[kind]++;
      // Only `kind` survives into the output. The overlay is decorative
      // and non-interactive (see InteractiveGeo's `contextFeatures`), so
      // names/ranks would be bytes nothing reads.
      features.push({ type: "Feature", properties: { kind }, geometry: clipped });
    }
  }

  let topo = topology({ [WATER_TOPOLOGY_OBJECT]: { type: "FeatureCollection", features } }, 1e6);
  // Same conservative threshold geo-build.mjs uses: Natural Earth 10m is
  // already generalized, so this only drops near-collinear points.
  topo = simplify(presimplify(topo), 1e-10);
  topo = quantize(topo, 1e5);
  const json = JSON.stringify(topo);
  writeFileSync(path.join(OUT_DIR, `${cityKey}.topo.json`), json);
  console.log(
    `  [${cityKey}] ${counts.area} water areas, ${counts.line} rivers -> ${cityKey}.topo.json (${(json.length / 1000).toFixed(1)}KB)`,
  );
  return { box: box.map((v) => Number(v.toFixed(4))), areas: counts.area, rivers: counts.line };
}

async function main() {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((c) => !(c in CITIES));
  if (unknown.length > 0) {
    console.error(`Unknown city key(s): ${unknown.join(", ")}. Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  const cityKeys = requested.length > 0 ? requested : Object.keys(CITIES);

  console.log(`Downloading Natural Earth 10m layers @ ${NATURAL_EARTH_COMMIT.slice(0, 7)}...`);
  const layers = {};
  for (const layer of [...AREA_LAYERS, ...LINE_LAYERS]) {
    layers[layer] = await fetchJson(`${NATURAL_EARTH_BASE}/${layer}.geojson`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : {};
  console.log("Building water TopoJSON:");
  for (const cityKey of cityKeys) {
    const built = buildCity(cityKey, layers);
    sources[cityKey] = {
      source: "Natural Earth 10m physical vectors",
      license: "Public domain",
      licenseSource: "https://www.naturalearthdata.com/about/terms-of-use/",
      commit: NATURAL_EARTH_COMMIT,
      layers: [...AREA_LAYERS, ...LINE_LAYERS],
      clipBox: built.box,
      areas: built.areas,
      rivers: built.rivers,
    };
  }
  const sorted = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
  writeFileSync(SOURCES_FILE, JSON.stringify(sorted, null, 2) + "\n");
}

await main();
