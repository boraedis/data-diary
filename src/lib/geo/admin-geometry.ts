import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { ADMIN_REGIONS, ADMIN_TOPOLOGY_OBJECT, type AdminRegionProperties } from "@/lib/geo/admin-regions";

// Lazy loaders for the committed per-country subdivision files (#304),
// shared by the server-side join (admin-lookup.ts) and the world map's
// click-to-expand (world-visits-chart.tsx).
//
// One `import()` per file, written out, rather than a template-literal
// import over the directory. A bundler can only split a dynamic import into
// its own chunk when it can see the path; a computed one either fails to
// resolve or drags every file into one context chunk, and the point is
// that clicking France fetches France's ~120KB and nothing else. The test
// alongside this file checks the table matches ADMIN_REGIONS both ways, so
// adding a country to one and forgetting the other fails a test rather
// than quietly leaving that country un-expandable.

type AdminTopology = Topology<{ [ADMIN_TOPOLOGY_OBJECT]: GeometryCollection<AdminRegionProperties> }>;

export const ADMIN_GEOMETRY_LOADERS: Record<string, () => Promise<unknown>> = {
  ARE: () => import("@/data/geo/admin/are.topo.json"),
  AUT: () => import("@/data/geo/admin/aut.topo.json"),
  BHS: () => import("@/data/geo/admin/bhs.topo.json"),
  CAN: () => import("@/data/geo/admin/can.topo.json"),
  CUB: () => import("@/data/geo/admin/cub.topo.json"),
  CZE: () => import("@/data/geo/admin/cze.topo.json"),
  DEU: () => import("@/data/geo/admin/deu.topo.json"),
  ESP: () => import("@/data/geo/admin/esp.topo.json"),
  FRA: () => import("@/data/geo/admin/fra.topo.json"),
  GBR: () => import("@/data/geo/admin/gbr.topo.json"),
  GRC: () => import("@/data/geo/admin/grc.topo.json"),
  HRV: () => import("@/data/geo/admin/hrv.topo.json"),
  HUN: () => import("@/data/geo/admin/hun.topo.json"),
  IDN: () => import("@/data/geo/admin/idn.topo.json"),
  IRL: () => import("@/data/geo/admin/irl.topo.json"),
  ISL: () => import("@/data/geo/admin/isl.topo.json"),
  ITA: () => import("@/data/geo/admin/ita.topo.json"),
  JPN: () => import("@/data/geo/admin/jpn.topo.json"),
  MAR: () => import("@/data/geo/admin/mar.topo.json"),
  NLD: () => import("@/data/geo/admin/nld.topo.json"),
  PER: () => import("@/data/geo/admin/per.topo.json"),
  POL: () => import("@/data/geo/admin/pol.topo.json"),
  SVK: () => import("@/data/geo/admin/svk.topo.json"),
  SVN: () => import("@/data/geo/admin/svn.topo.json"),
  TUR: () => import("@/data/geo/admin/tur.topo.json"),
  TZA: () => import("@/data/geo/admin/tza.topo.json"),
};

/** Decoded features, cached per country as the *promise* — same reasoning
 * as us-geo-levels.ts's own caches: two quick clicks on one country share
 * one in-flight import rather than racing two, and on the server the
 * decode happens once per process rather than once per request. */
const cache = new Map<string, Promise<FeatureCollection<Geometry, AdminRegionProperties>>>();

/** Whether a world-atlas country id has subdivision geometry at all. */
export function hasAdminRegions(worldAtlasId: string): boolean {
  return worldAtlasId in ADMIN_REGIONS;
}

/**
 * A country's subdivisions, by world-atlas id, or null for a country with
 * no entry in ADMIN_REGIONS — the caller's cue to fall back to plain
 * zoom-to-bounds (client) or to count that country's days as having no
 * subdivision to land in (server).
 */
export function loadAdminRegionFeatures(
  worldAtlasId: string,
): Promise<FeatureCollection<Geometry, AdminRegionProperties>> | null {
  const config = ADMIN_REGIONS[worldAtlasId];
  const load = config ? ADMIN_GEOMETRY_LOADERS[config.iso3] : undefined;
  if (!load) return null;
  let pending = cache.get(worldAtlasId);
  if (!pending) {
    pending = load().then((mod) => {
      const topo = ((mod as { default?: unknown }).default ?? mod) as AdminTopology;
      return feature(topo, topo.objects[ADMIN_TOPOLOGY_OBJECT]);
    });
    cache.set(worldAtlasId, pending);
  }
  return pending;
}
