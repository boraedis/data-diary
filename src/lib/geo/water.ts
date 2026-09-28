import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import type { CityKey } from "@/lib/geo/city-config";

// The city heatmaps' water overlay (#286) — shared by
// scripts/geo-build-water.mjs, which writes src/data/geo/water/*.topo.json,
// and city-heatmap-explorer.tsx, which lazy-loads them. See the build
// script's header for where the geometry comes from (Overture/OSM) and
// what's deliberately left out of it.

/** The TopoJSON object name every committed water file uses — one name for
 * all five cities, same convention as ADMIN_TOPOLOGY_OBJECT, so the loader
 * doesn't need a per-city accessor the way the neighborhood files (keyed
 * by city) do. */
export const WATER_TOPOLOGY_OBJECT = "water";

/** What each water feature carries after the build strips Overture's own
 * properties. Always "area" today (the build keeps polygons only); kept as
 * a field rather than dropped so a future line layer has somewhere to say
 * so — InteractiveGeo styles by geometry type either way. */
export type WaterProperties = { kind: "area" | "line" };

type WaterTopology = Topology<{ [WATER_TOPOLOGY_OBJECT]: GeometryCollection<WaterProperties> }>;

/** Lazy, not statically imported like the neighborhood files: each city's
 * water is 110–150KB (full-resolution OSM coastline is what makes it line
 * up with the neighborhoods), so bundling all five would add ~650KB to a
 * page that only ever shows one city at a time. One `import()` per file,
 * written out, for the reason admin-geometry.ts gives — a bundler can only
 * split a dynamic import into its own chunk when it can see the path.
 * `Record<CityKey, …>` makes a missing city a type error. */
const WATER_LOADERS: Record<CityKey, () => Promise<unknown>> = {
  atlanta: () => import("@/data/geo/water/atlanta.topo.json"),
  "dc-metro": () => import("@/data/geo/water/dc-metro.topo.json"),
  dubai: () => import("@/data/geo/water/dubai.topo.json"),
  nyc: () => import("@/data/geo/water/nyc.topo.json"),
  istanbul: () => import("@/data/geo/water/istanbul.topo.json"),
};

/** Cached as the promise, same as admin-geometry.ts: flicking between
 * cities re-uses one decode per city instead of re-importing, and the
 * FeatureCollection keeps a stable identity — it's a useD3 dependency in
 * InteractiveGeo, so a fresh decode would rebuild the map for nothing. */
const cache = new Map<CityKey, Promise<FeatureCollection<Geometry, WaterProperties>>>();

/** A city's water as GeoJSON, loading its file on first request. */
export function loadCityWater(city: CityKey): Promise<FeatureCollection<Geometry, WaterProperties>> {
  let pending = cache.get(city);
  if (!pending) {
    pending = WATER_LOADERS[city]().then((mod) => {
      const topo = ((mod as { default?: unknown }).default ?? mod) as WaterTopology;
      return feature(topo, topo.objects[WATER_TOPOLOGY_OBJECT]);
    });
    // A failed import shouldn't poison the cache — the next city switch
    // back gets a fresh attempt instead of the same rejection forever.
    pending.catch(() => cache.delete(city));
    cache.set(city, pending);
  }
  return pending;
}
