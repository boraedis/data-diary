import { normalizeAtlantaName } from "./atlanta-names";
import { normalizeDcMetroName } from "./dc-metro-names";
import { normalizeDubaiName } from "./dubai-names";
import { normalizeNycName } from "./nyc-names";
import { normalizeIstanbulName } from "./istanbul-names";

// Single source of truth for #177's 5 city-heatmap cities — shared by
// scripts/geo-build.mjs and scripts/geo-add-feature.mjs (imported via
// tsx, which runs .ts files directly, same as this app) and by
// src/lib/charts.ts's getCityHeatmapData. Previously this lived twice —
// a plain-JS copy under scripts/lib/ for the build tooling and an
// implicit, never-written second copy this app would have needed for
// #266 — collapsed into one file per #266's own note not to duplicate
// city/root config any more than the resolution logic itself.
export type CityKey = "atlanta" | "dc-metro" | "dubai" | "nyc" | "istanbul";

export type CityRootConfig = {
  /** Catalog root name — places.namePath's segment at `rootId`. */
  root: string;
  /** This root's real places.id in the current database — see
   * city-config's own git history / #265 for why name-matching alone
   * isn't reliable (a root's name can recur elsewhere in its own path,
   * e.g. Dubai the emirate containing Dubai the city). Stable for the
   * life of this one database; re-verify if the catalog is ever fully
   * reseeded. */
  rootId: number;
  /** Filename under src/data/geo/sources/ — build-tooling only, unused
   * by the app (which reads the committed .topo.json instead). */
  sourceFile: string;
};

export type CityConfig = {
  /** Display label for the city picker. */
  label: string;
  /** Filename under src/data/geo/ — both the topojson object key inside
   * that file and its own filename share this city's Record key, e.g.
   * "dc-metro" -> src/data/geo/dc-metro.topo.json's `objects["dc-metro"]`. */
  sources: CityRootConfig[];
  /** Normalizes a catalog neighborhood name to this city's geometry
   * naming — see each root's own normalize<City>Name for the real,
   * documented aliases/gaps. Takes `root` even for single-root cities so
   * every city shares one call signature. */
  normalize: (root: string, name: string) => string;
};

export const CITIES: Record<CityKey, CityConfig> = {
  atlanta: {
    label: "Atlanta",
    sources: [{ root: "Atlanta", rootId: 701, sourceFile: "atlanta.geojson" }],
    normalize: (_root, name) => normalizeAtlantaName(name),
  },
  "dc-metro": {
    label: "DC Metro",
    // Not one subtree: Arlington and Alexandria are their own catalog
    // roots (USA/Virginia/Arlington, USA/Virginia/Alexandria), not
    // descendants of the Washington place node — see #265's issue body
    // for how this was confirmed against the real catalog.
    sources: [
      { root: "Washington", rootId: 1566, sourceFile: "washington-dc.geojson" },
      { root: "Arlington", rootId: 83, sourceFile: "arlington.geojson" },
      { root: "Alexandria", rootId: 2000, sourceFile: "alexandria.geojson" },
    ],
    // Cast, not a widened DcMetroRoot signature on normalizeDcMetroName
    // itself — every caller of *this* config only ever passes a `root`
    // string that came from `sources[].root` above, which is always one
    // of the 3 real DcMetroRoot values; the wider `string` type here
    // exists only so every city can share one CityConfig["normalize"]
    // shape.
    normalize: normalizeDcMetroName as (root: string, name: string) => string,
  },
  dubai: {
    label: "Dubai",
    sources: [{ root: "Dubai", rootId: 554, sourceFile: "dubai.geojson" }],
    normalize: (_root, name) => normalizeDubaiName(name),
  },
  nyc: {
    label: "New York City",
    sources: [{ root: "New York City", rootId: 928, sourceFile: "nyc.geojson" }],
    normalize: (_root, name) => normalizeNycName(name),
  },
  istanbul: {
    label: "Istanbul",
    sources: [{ root: "Istanbul", rootId: 1607, sourceFile: "istanbul.geojson" }],
    normalize: (_root, name) => normalizeIstanbulName(name),
  },
};
