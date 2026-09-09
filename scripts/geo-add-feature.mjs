/**
 * Adds or replaces ONE neighborhood polygon in a #177 city's editable
 * GeoJSON source (src/data/geo/sources/*.geojson) — the modernized
 * equivalent of legacy's `scripts/geojson_editor.py`.
 *
 * What changed from legacy's version, deliberately: that script fetched
 * a polygon live from the Wikimapia API by numeric ID (and had a
 * hardcoded Wikimapia API key — see #163's own note on that). Wikimapia
 * isn't a reliable source going forward, and every #265 city's source
 * data now comes from a different place anyway (official municipal GIS,
 * or OSM/Overpass for Istanbul) — there's no one API that covers "redraw
 * a neighborhood" uniformly across all 5 cities. So this script doesn't
 * fetch anything itself. Sourcing a new/updated polygon is on you —
 * draw it at geojson.io, export a shape from Overpass Turbo, pull an
 * update from a city's own GIS portal, whatever fits that city — and
 * save the single Feature (or a FeatureCollection containing it) as a
 * local .geojson file. This script's job is purely the merge: same
 * "find by name, replace if it exists, append if it's new" logic
 * geojson_editor.py's `add` command had, plus the same winding-order fix
 * its `flip` command handled separately (folded in here unconditionally
 * instead of a second manual step).
 *
 * Usage:
 *   npm run geo:add-feature -- --city=atlanta --file=./redrawn.geojson [--name="Inman Park"] [--root=Washington]
 *
 *   --city   required, one of scripts/lib/geo-cities.mjs's keys
 *   --file   required, path to a GeoJSON Feature or a FeatureCollection
 *            containing exactly one Feature
 *   --name   optional override for the feature's display name — if
 *            omitted, uses the input feature's own `properties.name`
 *            (or `NAME`/`name`-shaped equivalents from a raw GIS export)
 *   --root   required only for dc-metro (3 source files) — which of
 *            Washington/Arlington/Alexandria this feature belongs to
 *
 * After this, re-run `npm run geo:build` to regenerate the committed
 * .topo.json, then commit both the sources/ diff and the rebuilt
 * .topo.json together.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixWinding } from "./lib/geo-winding.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = path.join(__dirname, "..", "src", "data", "geo", "sources");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function extractName(feature) {
  const props = feature.properties ?? {};
  return props.name ?? props.NAME ?? props.LABEL ?? props.Overlay_Name ?? props.neighborhood ?? null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.city || !args.file) {
    console.error("Usage: npm run geo:add-feature -- --city=<city> --file=<path.geojson> [--name=...] [--root=...]");
    console.error(`Known cities: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }

  const city = CITIES[args.city];
  if (!city) {
    console.error(`Unknown city "${args.city}". Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }

  let source;
  if (city.sources.length === 1) {
    source = city.sources[0];
  } else {
    if (!args.root) {
      console.error(`"${args.city}" has multiple sources — pass --root=${city.sources.map((s) => s.root).join("|")}`);
      process.exit(1);
    }
    source = city.sources.find((s) => s.root === args.root);
    if (!source) {
      console.error(`"${args.root}" isn't one of ${args.city}'s roots: ${city.sources.map((s) => s.root).join(", ")}`);
      process.exit(1);
    }
  }

  const input = JSON.parse(readFileSync(args.file, "utf8"));
  const inputFeature = input.type === "FeatureCollection" ? input.features[0] : input;
  if (input.type === "FeatureCollection" && input.features.length !== 1) {
    console.error(`${args.file} has ${input.features.length} features — this script merges exactly one at a time.`);
    process.exit(1);
  }
  if (!inputFeature?.geometry) {
    console.error(`${args.file} doesn't look like a GeoJSON Feature (no geometry).`);
    process.exit(1);
  }

  const name = args.name ?? extractName(inputFeature);
  if (!name) {
    console.error("Couldn't find a name on the input feature — pass --name explicitly.");
    process.exit(1);
  }

  const targetPath = path.join(SOURCES_DIR, source.sourceFile);
  const target = JSON.parse(readFileSync(targetPath, "utf8"));

  const newFeature = {
    type: "Feature",
    properties: { name, ...(args.city === "nyc" ? { group: inputFeature.properties?.group ?? "" } : {}) },
    geometry: fixWinding(inputFeature.geometry),
  };

  const existingIndex = target.features.findIndex((f) => f.properties.name.toLowerCase() === name.toLowerCase());
  if (existingIndex >= 0) {
    console.log(`Replacing existing "${name}" in ${source.sourceFile}`);
    target.features[existingIndex] = newFeature;
  } else {
    console.log(`Adding new "${name}" to ${source.sourceFile}`);
    target.features.push(newFeature);
  }
  target.features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

  // Indented, not minified — sources/ is the editable, diffable layer
  // (see geo-build.mjs's own header comment); a git diff on a
  // single-line file can't show which one feature actually changed.
  writeFileSync(targetPath, JSON.stringify(target, null, 1), "utf8");
  console.log(`\nWrote ${targetPath}. Next: npm run geo:build -- ${args.city}`);
}

main();
