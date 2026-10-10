/**
 * Builds the city heatmaps' road network overlay (#631):
 * src/data/geo/roads/<city>.topo.json, plus
 * src/data/geo/roads/SOURCES.json recording the exact upstream release.
 *
 * A sibling of geo-build-water.mjs (#286), sharing its Overture reader
 * (scripts/lib/overture.mjs) and its reasoning: the input is published data
 * nobody edits by hand, so there is no committed `sources/` copy, only the
 * small per-city clipped result.
 *
 * ## Source: Overture Maps' transportation/segment (OpenStreetMap)
 *
 * Same licence (ODbL) and attribution as the water. Segments are
 * LineStrings with a `subtype` (road / rail / water) and a `class`; only
 * `road` is read. The layer is 72GB, but spatially sorted with a bbox on
 * every row group, so a city costs a handful of row groups, as with water.
 *
 * ## Highways and major arteries only
 *
 * Ranks 1-3: motorway and trunk (1), primary (2), secondary (3), across the
 * whole drawn extent. That is what orients you at city scale and out in the
 * suburbs, and it is the part of a road network that stays small.
 *
 * Residential and tertiary streets were tried and dropped (#631): a street
 * grid is dominated by its junctions, which simplification has to keep, so
 * its size is set by the grid and not by the tolerance. Atlanta's came to
 * 1.4MB and Dubai's to 5MB at the most aggressive simplification. Service
 * roads, driveways, footways, cycleways, tracks and ramps (`link` subclass)
 * are dropped for the same reason.
 *
 * ## Shape
 *
 * Segments of the same `rank` (1 motorway/trunk ... 5 residential) are
 * merged into one MultiLineString feature, so a city's roads are a handful
 * of SVG paths rather than tens of thousands. Rank is the only property:
 * it picks the stroke width.
 *
 * Usage:
 *   npm run geo:build-roads [city...] [-- --cache=/tmp/roads-rows.json]
 *
 * No database access: the input is the committed neighborhood TopoJSON (for
 * the extent) plus Overture.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";
import { feature, quantize } from "topojson-client";
import { OVERTURE_RELEASE, clipGeometry, fetchLayerRows } from "./lib/overture.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { ROADS_TOPOLOGY_OBJECT } from "../src/lib/geo/roads.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "src", "data", "geo");
const OUT_DIR = path.join(GEO_DIR, "roads");
const SOURCES_FILE = path.join(OUT_DIR, "SOURCES.json");

/** Overture road `class` -> rank (1 = biggest). The keys are the only
 * classes kept; see the header for what's left out and why. */
const RANK_BY_CLASS = { motorway: 1, trunk: 1, primary: 2, secondary: 3 };

/** Padding around the extent a city covers, as a fraction of its longer
 * side — the map is fitted to the neighborhoods but the viewport rarely
 * shares their aspect ratio, and it can be panned (see geo-build-water's
 * "Clipping"). Smaller than water's: a road that stops short of the frame is
 * far less noticeable than a missing sea. */
const PAD_FACTOR = 0.1;

/** Per-city ceiling on the output file; the explorer lazy-loads one city's
 * roads at a time, alongside its water. */
const TARGET_BYTES = 250_000;

function isKept(row) {
  if (row.subtype !== "road" || row.subclass === "link") return false;
  const type = row.geometry?.type;
  return (type === "LineString" || type === "MultiLineString") && row.class in RANK_BY_CLASS;
}

function padded([x0, y0, x1, y1]) {
  const pad = PAD_FACTOR * Math.max(x1 - x0, y1 - y0);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** The padded extent of everything a city draws. */
function loadCity(cityKey) {
  const topo = JSON.parse(readFileSync(path.join(GEO_DIR, `${cityKey}.topo.json`), "utf8"));
  const [[x0, y0], [x1, y1]] = d3.geoBounds(feature(topo, topo.objects[cityKey]));
  return padded([x0, y0, x1, y1]);
}

const nodeKey = ([x, y]) => `${x},${y}`;

/**
 * Joins lines end to end wherever exactly two of them meet, so a road that
 * Overture cut into one segment per block comes out as one polyline.
 *
 * This is what makes simplification work at all. topojson treats every
 * line's endpoints as junctions that no later pass may remove, so a network
 * of per-block segments keeps at least two vertices per segment however
 * hard it's simplified: Atlanta's roads were 1.2MB at 0.8% of points
 * kept, because there was almost nothing left to remove. Chained, a
 * highway is one arc and its vertices are fair game. A node where three or
 * more lines meet (a real intersection) is left as a break, so the network's
 * shape isn't altered, only its bookkeeping.
 */
function chainLines(lines) {
  const ends = new Map(); // node -> [{ line index, which end }]
  lines.forEach((line, i) => {
    for (const [end, pt] of [
      [0, line[0]],
      [1, line[line.length - 1]],
    ]) {
      const key = nodeKey(pt);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ i, end });
    }
  });
  const used = new Array(lines.length).fill(false);
  const out = [];
  for (let start = 0; start < lines.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    let chain = lines[start].slice();
    for (const direction of ["forward", "backward"]) {
      for (;;) {
        const tip = direction === "forward" ? chain[chain.length - 1] : chain[0];
        const next = findPartnerOfChain(tip);
        if (!next) break;
        used[next.i] = true;
        // Orient the neighbour so it leaves `tip`.
        const line = lines[next.i];
        const leaving = nodeKey(line[0]) === nodeKey(tip) ? line : line.slice().reverse();
        chain = direction === "forward" ? chain.concat(leaving.slice(1)) : leaving.slice().reverse().concat(chain.slice(1));
      }
    }
    out.push(chain);
  }
  return out;

  // A chain's tip belongs to its latest segment, not `start`, so the lookup
  // is by node, not by the line that started the chain.
  function findPartnerOfChain(tip) {
    const here = ends.get(nodeKey(tip));
    if (!here || here.length !== 2) return null;
    const open = here.filter((e) => !used[e.i]);
    return open.length === 1 ? open[0] : null;
  }
}

/** Rows -> one MultiLineString feature per rank, clipped to `box`. */
function toFeatures(rows, box) {
  const byRank = new Map();
  for (const row of rows) {
    const rank = RANK_BY_CLASS[row.class];
    if (rank === undefined) continue; // a cache written when more classes were kept
    const clipped = clipGeometry(row.geometry, box);
    if (!clipped || clipped.type !== "MultiLineString") continue;
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(...clipped.coordinates);
  }
  return [...byRank.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, coordinates]) => ({
      type: "Feature",
      properties: { rank },
      geometry: { type: "MultiLineString", coordinates: chainLines(coordinates) },
    }));
}

/** Simplifies until the serialized topology fits `target`: the same loop as
 * the water's, without its polygon-inversion guard (a line has no inside to
 * invert). Goes further down than water does, since a dense street grid is
 * mostly near-collinear vertices. */
function buildTopology(features, target) {
  const base = presimplify(topology({ [ROADS_TOPOLOGY_OBJECT]: { type: "FeatureCollection", features } }, 1e6));
  let json = "";
  let kept = 1;
  for (const p of [1, 0.5, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.035, 0.025, 0.018, 0.012, 0.008]) {
    const minWeight = p === 1 ? 0 : quantile(base, p);
    const topo = quantize(simplify(structuredClone(base), minWeight), 1e5);
    json = JSON.stringify(topo);
    kept = p;
    if (json.length <= target) break;
  }
  if (json.length > target) console.warn(`    over the ${target / 1000}KB target even at ${kept * 100}% of points kept`);
  return { json, kept };
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const unknown = requested.filter((c) => !(c in CITIES));
  if (unknown.length > 0) {
    console.error(`Unknown city key(s): ${unknown.join(", ")}. Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  const cityKeys = requested.length > 0 ? requested : Object.keys(CITIES);
  const cities = cityKeys.map(loadCity);
  // One box per city, read in a single pass over the layer.
  const boxes = cities;

  // `--cache=<file>` saves the rows read from Overture on the first run and
  // reads them on later ones, for tuning the simplification without another
  // few minutes of range requests. Tied to the cities and boxes it was
  // written for, so it is only ever a scratch file.
  const cacheArg = process.argv.find((a) => a.startsWith("--cache="));
  const cachePath = cacheArg?.slice("--cache=".length);
  let rows;
  if (cachePath && existsSync(cachePath)) {
    console.log(`Reading ${cachePath}`);
    rows = JSON.parse(readFileSync(cachePath, "utf8"));
  } else {
    console.log(`Reading Overture ${OVERTURE_RELEASE} transportation/segment...`);
    rows = await fetchLayerRows({
      theme: "transportation",
      type: "segment",
      columns: ["subtype", "class", "subclass", "geometry"],
      boxes,
      keep: isKept,
    });
    if (cachePath) writeFileSync(cachePath, JSON.stringify(rows));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : {};
  console.log("Building road TopoJSON:");
  cityKeys.forEach((cityKey, i) => {
    const entry = {
      source: "Overture Maps transportation/segment (OpenStreetMap)",
      license: "ODbL 1.0",
      licenseSource: "https://docs.overturemaps.org/attribution/",
      release: OVERTURE_RELEASE,
    };
    const features = toFeatures(rows[i], boxes[i]);
    const { json, kept } = buildTopology(features, TARGET_BYTES);
    writeFileSync(path.join(OUT_DIR, `${cityKey}.topo.json`), json);
    entry.clipBox = boxes[i].map((v) => Number(v.toFixed(4)));
    entry.pointsKept = kept;
    console.log(
      `  [${cityKey}] ${features.length} rank(s), ${Math.round(kept * 100 * 10) / 10}% of points kept -> ${cityKey}.topo.json (${(json.length / 1000).toFixed(1)}KB)`,
    );
    sources[cityKey] = entry;
  });
  const sorted = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
  writeFileSync(SOURCES_FILE, JSON.stringify(sorted, null, 2) + "\n");
}

await main();
