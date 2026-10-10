/**
 * Builds the city heatmaps' metro overlay (#639): src/data/geo/transit/<city>.topo.json,
 * plus src/data/geo/transit/SOURCES.json recording when each file was fetched
 * and what it was built from.
 *
 * ## Source: OpenStreetMap route relations, via the Overpass API
 *
 * Lines are the `route=subway|light_rail|monorail|tram` relations in each
 * city's box, not Overture's rail segments. A route relation is what the
 * network's own mappers drew for one line, so it's the only place that says
 * which track belongs to which line and what colour the line is (`colour`).
 * Overture's rail segments carry neither, and they include depot, siding and
 * service track that would draw as side lines (#639, first pass).
 *
 * Each line is keyed by its `network` and `ref`: the several relations that
 * make up one line (a direction each, or a rush-hour variant) merge into one
 * feature, with each way counted once. Only the running ways are kept (role
 * `""`, `forward` or `backward`), so platforms and stops aren't drawn as track.
 *
 * Stations are `railway=station` nodes tagged `station=subway|light_rail|monorail`
 * in the box. A station mapped as several nodes (one per entrance or platform
 * group) is kept once, by name, within about 50m.
 *
 * ## Licence
 *
 * OpenStreetMap data, ODbL 1.0. The methodology text carries the attribution.
 *
 * ## Size
 *
 * Each city's file is clipped to its padded bounds and simplified to fit the
 * same per-city budget as the roads. The simplifier is shared with the roads
 * (scripts/lib/line-topology.mjs).
 *
 * Usage:
 *   npm run geo:build-transit [city...]
 *
 * No database access: the input is the committed neighbourhood TopoJSON (for
 * the extent) plus Overpass.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { feature } from "topojson-client";
import { clipGeometry } from "./lib/overture.mjs";
import { buildTopology, chainLines } from "./lib/line-topology.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";
import { TRANSIT_TOPOLOGY_OBJECT } from "../src/lib/geo/transit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "src", "data", "geo");
const OUT_DIR = path.join(GEO_DIR, "transit");
const SOURCES_FILE = path.join(OUT_DIR, "SOURCES.json");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "data-diary-geo-build/1.0";
const ROUTE_TYPES = "subway|light_rail|monorail|tram";
const STATION_TYPES = "subway|light_rail|monorail";

/** Member roles that are the line's own track. Platforms, stops and
 * entrances have other roles and are left out. */
const TRACK_ROLES = new Set(["", "forward", "backward"]);

/** Two stations of the same name closer than this (in degrees, ~50m) are
 * one station. */
const STATION_MERGE_DEG = 0.0005;

/** Same padding as the roads build, so a line that runs just past the frame
 * still reaches it. */
const PAD_FACTOR = 0.1;

/** Per-city ceiling on the output file, as for the roads. */
const TARGET_BYTES = 250_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Overpass answers a busy or timed-out query with a 200 HTML page or a
 * 5xx, so success is judged by the body being JSON. */
async function overpass(query, label) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
    });
    const text = await res.text();
    if (res.ok && text.trimStart().startsWith("{")) return JSON.parse(text);
    if (attempt >= 5) throw new Error(`${label}: Overpass still failing (${res.status}) after ${attempt} attempts`);
    console.warn(`  ${label}: Overpass busy (${res.status}); retrying (${attempt}/4)`);
    await sleep(20_000 * attempt);
  }
}

/** The padded extent of everything a city draws, as [x0, y0, x1, y1]. */
function loadCity(cityKey) {
  const topo = JSON.parse(readFileSync(path.join(GEO_DIR, `${cityKey}.topo.json`), "utf8"));
  const [[x0, y0], [x1, y1]] = d3.geoBounds(feature(topo, topo.objects[cityKey]));
  const pad = PAD_FACTOR * Math.max(x1 - x0, y1 - y0);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** Overpass takes its box as south,west,north,east. */
const overpassBox = ([x0, y0, x1, y1]) => `${y0},${x0},${y1},${x1}`;

/** `#rrggbb` in lower case, or undefined when the tag is absent or not a hex
 * colour (OSM has the odd named colour, which the stroke can't use). */
function normaliseColour(value) {
  if (!value) return undefined;
  const hex = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : undefined;
}

/** Route relations -> one line per network+ref, as a MultiLineString clipped
 * to `box`. */
function toLines(relations, box) {
  const byLine = new Map();
  for (const rel of relations) {
    const tags = rel.tags ?? {};
    const key = `${tags.network ?? ""}|${tags.ref ?? tags.name ?? rel.id}`;
    if (!byLine.has(key)) byLine.set(key, { ref: tags.ref ?? tags.name ?? "", colour: undefined, ways: new Map() });
    const line = byLine.get(key);
    line.colour ??= normaliseColour(tags.colour);
    for (const member of rel.members ?? []) {
      if (member.type !== "way" || !member.geometry || !TRACK_ROLES.has(member.role ?? "")) continue;
      // A way shared by two variants of the same line is drawn once.
      if (!line.ways.has(member.ref)) line.ways.set(member.ref, member.geometry.map((p) => [p.lon, p.lat]));
    }
  }
  const features = [];
  for (const line of byLine.values()) {
    const clipped = clipGeometry({ type: "MultiLineString", coordinates: [...line.ways.values()] }, box);
    if (!clipped || clipped.type !== "MultiLineString") continue;
    features.push({
      type: "Feature",
      properties: { kind: "line", ref: line.ref, ...(line.colour ? { colour: line.colour } : {}) },
      geometry: { type: "MultiLineString", coordinates: chainLines(clipped.coordinates) },
    });
  }
  return features;
}

/** Station nodes -> one Point feature per station, inside `box`. */
function toStations(nodes, box) {
  const [x0, y0, x1, y1] = box;
  const kept = [];
  for (const node of nodes) {
    const { lon, lat } = node;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    const name = node.tags?.name ?? "";
    const duplicate = kept.some(
      (s) =>
        s.name === name &&
        Math.abs(s.lon - lon) < STATION_MERGE_DEG &&
        Math.abs(s.lat - lat) < STATION_MERGE_DEG,
    );
    if (!duplicate) kept.push({ name, lon, lat });
  }
  return kept.map((s) => ({
    type: "Feature",
    properties: { kind: "station", ...(s.name ? { name: s.name } : {}) },
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
  }));
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const unknown = requested.filter((c) => !(c in CITIES));
  if (unknown.length > 0) {
    console.error(`Unknown city key(s): ${unknown.join(", ")}. Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  const cityKeys = requested.length > 0 ? requested : Object.keys(CITIES);

  mkdirSync(OUT_DIR, { recursive: true });
  const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : {};
  const fetchedAt = new Date().toISOString().slice(0, 10);
  console.log("Building transit TopoJSON:");
  for (const cityKey of cityKeys) {
    const box = loadCity(cityKey);
    const bbox = overpassBox(box);
    const routes = await overpass(
      `[out:json][timeout:450];relation["route"~"^(${ROUTE_TYPES})$"](${bbox});out geom;`,
      `${cityKey} routes`,
    );
    await sleep(5_000);
    const stationNodes = await overpass(
      `[out:json][timeout:180];node["railway"="station"]["station"~"^(${STATION_TYPES})$"](${bbox});out body;`,
      `${cityKey} stations`,
    );
    const lines = toLines(routes.elements, box);
    const stations = toStations(stationNodes.elements, box);
    const features = [...lines, ...stations];
    const { json, kept } = buildTopology(features, TARGET_BYTES, TRANSIT_TOPOLOGY_OBJECT);
    writeFileSync(path.join(OUT_DIR, `${cityKey}.topo.json`), json);
    sources[cityKey] = {
      source: "OpenStreetMap route relations and station nodes, via the Overpass API",
      license: "ODbL 1.0",
      licenseSource: "https://www.openstreetmap.org/copyright",
      fetchedAt,
      routeTypes: ROUTE_TYPES.split("|"),
      stationTypes: STATION_TYPES.split("|"),
      lines: lines.length,
      stations: stations.length,
      clipBox: box.map((v) => Number(v.toFixed(4))),
      pointsKept: kept,
    };
    console.log(
      `  [${cityKey}] ${lines.length} line(s), ${stations.length} station(s), ${Math.round(kept * 100 * 10) / 10}% of points kept -> ${cityKey}.topo.json (${(json.length / 1000).toFixed(1)}KB)`,
    );
    // Written per city, so a failure on a later city can't leave SOURCES.json
    // describing files that were never replaced.
    const sorted = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
    writeFileSync(SOURCES_FILE, JSON.stringify(sorted, null, 2) + "\n");
    await sleep(5_000);
  }
}

await main();
