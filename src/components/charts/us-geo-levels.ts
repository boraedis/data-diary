"use client";

import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { geoLevel, type GeoLevel } from "@/components/charts/interactive/interactive-geo";

// The US half of #107's drill-down, shared by both maps that use it: the
// world map drills a clicked USA into states, and the US map drills a
// clicked state into its counties. Both need the same geometry loading,
// the same albersUsa filtering rule and the same level shape, so it lives
// here once rather than being written twice with two chances to diverge.
//
// Everything here is client-side. The server has its own, separate reason
// to touch county geometry (the point-in-polygon join in
// src/lib/geo/us-counties.ts) and imports it eagerly there; this module
// never does — see loadUsCountyFeatures below.

export type UsStateProperties = { name: string };
export type UsCountyProperties = { name: string };

/**
 * us-atlas ships 56 state-level features: the 50 states, DC (FIPS 11), and
 * 5 territories — American Samoa (60), Guam (66), the Northern Mariana
 * Islands (69), Puerto Rico (72) and the US Virgin Islands (78). FIPS
 * codes for the states and DC all fall at or below 56 and the territories
 * all start at 60, so the numeric cut is exact rather than a heuristic.
 *
 * The cut exists because d3.geoAlbersUsa — the composite projection that
 * produces the familiar lower-48 layout with Alaska and Hawaii as insets —
 * has no defined position for anything outside the 50 states + DC: it
 * returns null for those coordinates. A territory feature left in would
 * render as a path with no `d`: invisible, unhoverable, and still sitting
 * in the legend's color domain.
 */
export const MAX_ALBERS_USA_FIPS = 56;

/** Whether a us-atlas feature id belongs to something geoAlbersUsa can
 * actually place. Takes a state OR county id — a county's FIPS starts with
 * its state's two digits, so the same threshold answers both. */
export function isAlbersUsaDrawable(id: string | number | undefined): boolean {
  if (id == null) return false;
  return Number(String(id).slice(0, 2)) <= MAX_ALBERS_USA_FIPS;
}

/** The projection every US level in this file draws with. A drilled-in
 * state keeps the composite rather than switching to something fitted to
 * that one state: `fitSize` already zooms to whatever features it's given,
 * so the counties fill the frame either way, and staying on one projection
 * means the shapes don't subtly change form as you drill in and back out. */
export const usProjection = () => d3.geoAlbersUsa();

// Decoded topology is cached at module scope, keyed by nothing more
// elaborate than "have we loaded it yet" — drilling into a second state
// shouldn't re-import and re-decode 842KB of county geometry. The promise
// itself is cached, not just its result, so two rapid clicks share one
// in-flight import instead of racing two.
let statesPromise: Promise<FeatureCollection<Geometry, UsStateProperties>> | null = null;
let countiesPromise: Promise<FeatureCollection<Geometry, UsCountyProperties>> | null = null;

/** Every state geoAlbersUsa can draw. Dynamically imported so the world
 * map doesn't ship US state geometry to someone who never clicks the US. */
export function loadUsStateFeatures(): Promise<FeatureCollection<Geometry, UsStateProperties>> {
  statesPromise ??= import("us-atlas/states-10m.json").then((mod) => {
    const topo = (mod.default ?? mod) as unknown as Topology<{ states: GeometryCollection<UsStateProperties> }>;
    const decoded = feature(topo, topo.objects.states);
    return { ...decoded, features: decoded.features.filter((f) => isAlbersUsaDrawable(f.id)) };
  });
  return statesPromise;
}

/**
 * The counties of one state, by its 2-digit FIPS code.
 *
 * The whole county layer is ~842KB of TopoJSON — by a wide margin the
 * largest thing any chart in this app would load, and pointless for the
 * majority of visits that never drill in. `import()` keeps it out of the
 * initial bundle entirely: it's fetched the first time someone clicks a
 * state, then reused from the cache above for every state after that.
 */
export function loadUsCountyFeatures(stateFips: string): Promise<FeatureCollection<Geometry, UsCountyProperties>> {
  countiesPromise ??= import("us-atlas/counties-10m.json").then((mod) => {
    const topo = (mod.default ?? mod) as unknown as Topology<{ counties: GeometryCollection<UsCountyProperties> }>;
    return feature(topo, topo.objects.counties);
  });
  return countiesPromise.then((all) => ({
    ...all,
    // Prefix match on FIPS, not a name lookup — county names repeat
    // constantly across states (34 states have a Washington County).
    features: all.features.filter((f) => String(f.id).startsWith(stateFips)),
  }));
}

/** The "all US states" level — the world map's first step in, and the US
 * map's own root. */
export function usStatesLevel(
  features: FeatureCollection<Geometry, UsStateProperties>,
  daysByState: ReadonlyMap<string, number>,
): GeoLevel {
  return geoLevel<UsStateProperties>({
    key: "us-states",
    label: "United States",
    features,
    getValue: (f) => daysByState.get(f.properties.name) ?? null,
    getLabel: (f) => f.properties.name,
    projection: usProjection,
    valueLabel: "days",
    ariaLabel:
      "Map of the United States, with each state shaded by how many days you've logged there. Click a state to drill into its counties, or use the breadcrumb above to go back.",
  });
}

/** One state's counties. `stateName` is only the breadcrumb label — the
 * features themselves were already narrowed by FIPS. */
export function usCountiesLevel(
  stateName: string,
  stateFips: string,
  features: FeatureCollection<Geometry, UsCountyProperties>,
  daysByCountyFips: ReadonlyMap<string, number>,
): GeoLevel {
  return geoLevel<UsCountyProperties>({
    key: `us-counties-${stateFips}`,
    label: stateName,
    features,
    // Keyed by FIPS id, not name — see loadUsCountyFeatures above.
    getValue: (f) => daysByCountyFips.get(String(f.id)) ?? null,
    getLabel: (f) => f.properties.name,
    projection: usProjection,
    valueLabel: "days",
    ariaLabel: `Counties of ${stateName}, each shaded by how many days you've logged there. Use the breadcrumb above to go back out.`,
  });
}
