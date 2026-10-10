/**
 * Builds the city heatmaps' metro overlay (#639): src/data/geo/transit/<city>.topo.json,
 * plus src/data/geo/transit/SOURCES.json recording the exact upstream release
 * and the licence each row was read under.
 *
 * A sibling of geo-build-roads.mjs (#631) and geo-build-water.mjs (#286),
 * sharing their Overture reader (scripts/lib/overture.mjs) and simplifier
 * (scripts/lib/line-topology.mjs), and the same reasoning: the input is
 * published data nobody edits by hand, so only the small per-city clipped
 * result is committed.
 *
 * ## Lines: urban rail from Overture's transportation/segment
 *
 * Segments whose `subtype` is `rail` and whose `class` is one of the urban
 * systems: subway, light_rail, monorail and tram. Mainline and commuter
 * track (`standard_gauge`) is left out: it's freight and intercity track
 * that would bury the metro in NYC and Atlanta, and the chart is about where
 * the metro goes. `unknown` is left out for the same reason, since its
 * members can't be told apart from freight sidings.
 *
 * Lines are chained end to end at two-way junctions (see line-topology.mjs)
 * and written as one MultiLineString per city, so the file is one path.
 *
 * ## Stations: metro stops from Overture's places/place
 *
 * Points whose `taxonomy.primary` is `metro_station` or
 * `light_rail_and_subway_station`. Train stations (`train_station`) are
 * left out for the same reason as commuter track. The overlay draws them only
 * once you zoom in close (InteractiveGeo), so every station is kept, not
 * just the ones near the centre.
 *
 * The places theme is not all one licence, so each row carries its own
 * `sources` list. The distinct (dataset, licence) pairs seen for each city's
 * kept stations are written to SOURCES.json, and the methodology text is the
 * place they're credited in.
 *
 * Usage:
 *   npm run geo:build-transit [city...]
 *
 * No database access: the input is the committed neighbourhood TopoJSON (for
 * the extent) plus Overture.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { feature } from "topojson-client";
import { OVERTURE_RELEASE, clipGeometry, fetchLayerRows } from "./lib/overture.mjs";
import { buildTopology, chainLines } from "./lib/line-topology.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { TRANSIT_TOPOLOGY_OBJECT } from "../src/lib/geo/transit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "src", "data", "geo");
const OUT_DIR = path.join(GEO_DIR, "transit");
const SOURCES_FILE = path.join(OUT_DIR, "SOURCES.json");

/** Overture rail `class` values kept as metro lines (see the header). */
const LINE_CLASSES = new Set(["subway", "light_rail", "monorail", "tram"]);

/** Overture place categories kept as metro stations (see the header). */
const STATION_CATEGORIES = new Set(["metro_station", "light_rail_and_subway_station"]);

/** Same padding as the roads build, so a line that runs just past the
 * frame still reaches it. */
const PAD_FACTOR = 0.1;

/** Per-city ceiling on the output file, as for the roads. */
const TARGET_BYTES = 250_000;

function isLine(row) {
  const type = row.geometry?.type;
  return row.subtype === "rail" && LINE_CLASSES.has(row.class) && (type === "LineString" || type === "MultiLineString");
}

function isStation(row) {
  return row.geometry?.type === "Point" && STATION_CATEGORIES.has(row.taxonomy?.primary);
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

/** `"<dataset> (<licence>)"` for every source a row cites, so the
 * SOURCES file can say which licence the stations were read under. */
function licencesOf(row) {
  return (row.sources ?? []).map((s) => `${s.dataset} (${s.license})`);
}

/** Rows -> one MultiLineString feature (kind line) and one Point feature per
 * station, both clipped to `box`. */
function toFeatures(lineRows, stationRows, box, licences) {
  const coordinates = [];
  for (const row of lineRows) {
    const clipped = clipGeometry(row.geometry, box);
    if (!clipped || clipped.type !== "MultiLineString") continue;
    coordinates.push(...clipped.coordinates);
    for (const l of licencesOf(row)) licences.lines.add(l);
  }
  const features = [];
  if (coordinates.length > 0) {
    features.push({
      type: "Feature",
      properties: { kind: "line" },
      geometry: { type: "MultiLineString", coordinates: chainLines(coordinates) },
    });
  }
  const [x0, y0, x1, y1] = box;
  let stations = 0;
  for (const row of stationRows) {
    const [x, y] = row.geometry.coordinates;
    // The rows came back for overlapping row groups, so a station just
    // outside the box can still be among them; keep only those inside.
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    features.push({ type: "Feature", properties: { kind: "station" }, geometry: row.geometry });
    stations++;
    for (const l of licencesOf(row)) licences.stations.add(l);
  }
  return { features, stations };
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const unknown = requested.filter((c) => !(c in CITIES));
  if (unknown.length > 0) {
    console.error(`Unknown city key(s): ${unknown.join(", ")}. Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  const cityKeys = requested.length > 0 ? requested : Object.keys(CITIES);
  const boxes = cityKeys.map(loadCity);

  console.log(`Reading Overture ${OVERTURE_RELEASE} transportation/segment (rail)...`);
  const lineRows = await fetchLayerRows({
    theme: "transportation",
    type: "segment",
    columns: ["subtype", "class", "geometry", "sources"],
    boxes,
    keep: isLine,
  });
  console.log(`Reading Overture ${OVERTURE_RELEASE} places/place (metro stations)...`);
  const stationRows = await fetchLayerRows({
    theme: "places",
    type: "place",
    columns: ["taxonomy", "geometry", "sources"],
    boxes,
    keep: isStation,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : {};
  console.log("Building transit TopoJSON:");
  cityKeys.forEach((cityKey, i) => {
    const licences = { lines: new Set(), stations: new Set() };
    const { features, stations } = toFeatures(lineRows[i], stationRows[i], boxes[i], licences);
    const { json, kept } = buildTopology(features, TARGET_BYTES, TRANSIT_TOPOLOGY_OBJECT);
    writeFileSync(path.join(OUT_DIR, `${cityKey}.topo.json`), json);
    sources[cityKey] = {
      release: OVERTURE_RELEASE,
      lineClasses: [...LINE_CLASSES],
      stationCategories: [...STATION_CATEGORIES],
      lines: { licences: [...licences.lines].sort() },
      stations: { count: stations, licences: [...licences.stations].sort() },
      clipBox: boxes[i].map((v) => Number(v.toFixed(4))),
      pointsKept: kept,
    };
    console.log(
      `  [${cityKey}] ${stations} station(s), ${features.length - stations} line feature(s), ${Math.round(kept * 100 * 10) / 10}% of points kept -> ${cityKey}.topo.json (${(json.length / 1000).toFixed(1)}KB)`,
    );
  });
  const sorted = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
  writeFileSync(SOURCES_FILE, JSON.stringify(sorted, null, 2) + "\n");
}

await main();
