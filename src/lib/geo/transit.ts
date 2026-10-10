import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import type { CityKey } from "@/lib/geo/city-config";

// The city heatmaps' metro overlay (#639): urban rail lines and metro
// station points, drawn over the same maps as the road network — shared by
// scripts/geo-build-transit.mjs, which writes src/data/geo/transit/*.topo.json,
// and city-heatmap-explorer.tsx, which lazy-loads them. See the build
// script's header for where the geometry comes from (Overture/OSM) and which
// rail classes are kept.

/** The TopoJSON object name every committed transit file uses, same
 * convention as ROADS_TOPOLOGY_OBJECT. */
export const TRANSIT_TOPOLOGY_OBJECT = "transit";

/** `line` for a rail alignment, `station` for a metro station point. Lines
 * are one MultiLineString per city; stations are one Point per station. */
export type TransitProperties = { kind: "line" | "station" };

type TransitTopology = Topology<{ [TRANSIT_TOPOLOGY_OBJECT]: GeometryCollection<TransitProperties> }>;

/** Lazy for the same reason the roads are (see roads.ts). One written-out
 * `import()` per file so the bundler can split each into its own chunk;
 * `Record<CityKey, …>` makes a missing city a type error. */
const TRANSIT_LOADERS: Record<CityKey, () => Promise<unknown>> = {
  atlanta: () => import("@/data/geo/transit/atlanta.topo.json"),
  "dc-metro": () => import("@/data/geo/transit/dc-metro.topo.json"),
  dubai: () => import("@/data/geo/transit/dubai.topo.json"),
  nyc: () => import("@/data/geo/transit/nyc.topo.json"),
  istanbul: () => import("@/data/geo/transit/istanbul.topo.json"),
};

/** Cached as the promise, like roads.ts: flicking between cities re-uses one
 * decode, and the FeatureCollection keeps a stable identity (it ends up in a
 * useD3 dependency array in InteractiveGeo). */
const cache = new Map<CityKey, Promise<FeatureCollection<Geometry, TransitProperties>>>();

/** A city's metro lines and stations as GeoJSON, loading its file on first
 * request. */
export function loadCityTransit(city: CityKey): Promise<FeatureCollection<Geometry, TransitProperties>> {
  let pending = cache.get(city);
  if (!pending) {
    pending = TRANSIT_LOADERS[city]().then((mod) => {
      const topo = ((mod as { default?: unknown }).default ?? mod) as TransitTopology;
      return feature(topo, topo.objects[TRANSIT_TOPOLOGY_OBJECT]);
    });
    // A failed import shouldn't poison the cache: the next request retries.
    pending.catch(() => cache.delete(city));
    cache.set(city, pending);
  }
  return pending;
}
