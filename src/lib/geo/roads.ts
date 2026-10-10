import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import type { CityKey } from "@/lib/geo/city-config";

// The city heatmaps' road overlay (#631): highways and major arteries only —
// shared by scripts/geo-build-roads.mjs, which writes
// src/data/geo/roads/*.topo.json, and city-heatmap-explorer.tsx, which
// lazy-loads them. See the build script's header for where the geometry
// comes from (Overture/OSM) and why it stops at secondary roads.

/** The TopoJSON object name every committed roads file uses, same
 * convention as WATER_TOPOLOGY_OBJECT. */
export const ROADS_TOPOLOGY_OBJECT = "roads";

/** `rank` 1 (motorway/trunk), 2 (primary) or 3 (secondary): the only
 * property the build keeps, and what picks a road's stroke width. */
export type RoadProperties = { rank: number };

type RoadsTopology = Topology<{ [ROADS_TOPOLOGY_OBJECT]: GeometryCollection<RoadProperties> }>;

/** Lazy for the same reason the water is (see water.ts): per-city files are
 * a few hundred KB, and a page shows one city at a time. One written-out
 * `import()` per file so the bundler can split each into its own chunk;
 * `Record<CityKey, …>` makes a missing city a type error. */
const ROAD_LOADERS: Record<CityKey, () => Promise<unknown>> = {
  atlanta: () => import("@/data/geo/roads/atlanta.topo.json"),
  "dc-metro": () => import("@/data/geo/roads/dc-metro.topo.json"),
  dubai: () => import("@/data/geo/roads/dubai.topo.json"),
  nyc: () => import("@/data/geo/roads/nyc.topo.json"),
  istanbul: () => import("@/data/geo/roads/istanbul.topo.json"),
};

/** Cached as the promise, like water.ts: flicking between cities re-uses one
 * decode, and the FeatureCollection keeps a stable identity (it ends up in a
 * useD3 dependency array in InteractiveGeo). */
const cache = new Map<CityKey, Promise<FeatureCollection<Geometry, RoadProperties>>>();

/** A city's roads as GeoJSON, loading its file on first request. */
export function loadCityRoads(city: CityKey): Promise<FeatureCollection<Geometry, RoadProperties>> {
  let pending = cache.get(city);
  if (!pending) {
    pending = ROAD_LOADERS[city]().then((mod) => {
      const topo = ((mod as { default?: unknown }).default ?? mod) as RoadsTopology;
      return feature(topo, topo.objects[ROADS_TOPOLOGY_OBJECT]);
    });
    // A failed import shouldn't poison the cache: the next request retries.
    pending.catch(() => cache.delete(city));
    cache.set(city, pending);
  }
  return pending;
}
