// The city heatmaps' water overlay (#286) — shared by
// scripts/geo-build-water.mjs, which writes src/data/geo/water/*.topo.json,
// and city-heatmap-explorer.tsx, which reads them. See the build script's
// header for where the geometry comes from and why it's good enough at
// city scale despite being coarse.

/** The TopoJSON object name every committed water file uses — one name for
 * all five cities, same convention as ADMIN_TOPOLOGY_OBJECT, so the loader
 * doesn't need a per-city accessor the way the neighborhood files (keyed
 * by city) do. */
export const WATER_TOPOLOGY_OBJECT = "water";

/** What each water feature carries after the build strips Natural Earth's
 * own properties. `area` is filled water (ocean, bays, lakes) and `line`
 * a river centerline — InteractiveGeo draws its `contextFeatures` by
 * geometry type, so this is informational rather than load-bearing. */
export type WaterProperties = { kind: "area" | "line" };
