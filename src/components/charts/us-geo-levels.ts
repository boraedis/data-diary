"use client";

import * as d3 from "d3";
import { feature, merge } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { geoExpansion, type GeoExpansion } from "@/components/charts/interactive/interactive-geo";
import { CBSA_AREAS, cbsaCodeForCounty, type CbsaKind } from "@/lib/geo/us-cbsa";

// The US half of #107's drill-down, shared by both maps that use it: the
// world map expands a clicked USA into states, and the US map expands a
// clicked state into its counties. Both need the same geometry loading,
// the same feature filtering and the same expansion shape, so it lives
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

/** The projection the US map draws with. Only the *base* map names a
 * projection at all — expansions are drawn through whatever the map is
 * already fitted to, which is what puts a state's counties inside the
 * outline the state itself occupied (see GeoExpansion). */
export const usProjection = () => d3.geoAlbersUsa();

// Decoded topology is cached at module scope, keyed by nothing more
// elaborate than "have we loaded it yet" — drilling into a second state
// shouldn't re-import and re-decode 842KB of county geometry. The promise
// itself is cached, not just its result, so two rapid clicks share one
// in-flight import instead of racing two.
let statesPromise: Promise<FeatureCollection<Geometry, UsStateProperties>> | null = null;
/** The county layer's raw *topology*, not its decoded features.
 *
 * Kept in this form because `topojson.merge` — which dissolves a set of
 * counties into one metro polygon (#313) — works on arcs, and arcs only
 * exist before decoding. Decoded GeoJSON has already thrown away the
 * shared-border information that makes the dissolve possible; merging
 * decoded polygons would need real polygon-clipping instead. Everything
 * that wants features derives them from here. */
let countyTopologyPromise: Promise<CountyTopology> | null = null;
let metroPromise: Promise<FeatureCollection<Geometry, UsMetroProperties>> | null = null;

type CountyTopology = Topology<{ counties: GeometryCollection<UsCountyProperties> }>;

function loadCountyTopology(): Promise<CountyTopology> {
  countyTopologyPromise ??= import("us-atlas/counties-10m.json").then(
    (mod) => (mod.default ?? mod) as unknown as CountyTopology,
  );
  return countyTopologyPromise;
}

/**
 * The 50 states plus DC — us-atlas's 5 territories filtered out.
 * Dynamically imported so the world map doesn't ship US state geometry to
 * someone who never clicks the US.
 *
 * Both consumers want exactly these 51, but for two independent reasons
 * that happen to coincide, and it's worth not mistaking one for the other:
 *
 *  - On the US map, because geoAlbersUsa can't place a territory at all
 *    (see MAX_ALBERS_USA_FIPS).
 *  - On the world map, because these replace world-atlas's own "United
 *    States of America" polygon, and that polygon covers the 50 states and
 *    DC only. world-atlas ships Puerto Rico as its *own country feature*,
 *    already drawn separately with its own value — so including us-atlas's
 *    Puerto Rico here would stack a second polygon on top of it.
 */
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
  return loadAllUsCountyFeatures().then((all) => ({
    ...all,
    // Prefix match on FIPS, not a name lookup — county names repeat
    // constantly across states (34 states have a Washington County).
    features: all.features.filter((f) => String(f.id).startsWith(stateFips)),
  }));
}

/** Every county in the 50 states + DC, for the map's flat county view.
 *
 * Same 842KB import as the drill-down uses, and the same module-level
 * cache, so switching between the county view and drilling into a state
 * fetches it at most once per session either way. */
export function loadAllUsCountyFeatures(): Promise<FeatureCollection<Geometry, UsCountyProperties>> {
  return loadCountyTopology().then((topo) => {
    const decoded = feature(topo, topo.objects.counties);
    return { ...decoded, features: decoded.features.filter((f) => isAlbersUsaDrawable(f.id)) };
  });
}

/** The US, broken into its states — the world map's expansion for the
 * United States. */
export function usStatesExpansion(
  features: FeatureCollection<Geometry, UsStateProperties>,
  daysByState: ReadonlyMap<string, number>,
): GeoExpansion {
  return geoExpansion<UsStateProperties>({
    key: "us-states",
    label: "United States",
    features,
    getValue: (f) => daysByState.get(f.properties.name) ?? null,
    getLabel: (f) => f.properties.name,
    valueLabel: "days",
  });
}

/** One state, broken into its counties. `stateName` labels the collapse
 * chip; the features themselves were already narrowed by FIPS. */
export function usCountiesExpansion(
  stateName: string,
  stateFips: string,
  features: FeatureCollection<Geometry, UsCountyProperties>,
  daysByCountyFips: ReadonlyMap<string, number>,
): GeoExpansion {
  return geoExpansion<UsCountyProperties>({
    key: `us-counties-${stateFips}`,
    label: stateName,
    features,
    // Keyed by FIPS id, not name — see loadUsCountyFeatures above.
    getValue: (f) => daysByCountyFips.get(String(f.id)) ?? null,
    getLabel: (f) => f.properties.name,
    valueLabel: "days",
  });
}

// --- Metro (CBSA) tier -----------------------------------------------------

export type UsMetroProperties = {
  name: string;
  /** What this polygon actually is. A metro-view map is a mix: dissolved
   * statistical areas where one exists, and plain counties everywhere
   * else — roughly half the country's counties belong to no CBSA at all. */
  kind: CbsaKind | "county";
};

/**
 * The metro view's base map (#313): every CBSA dissolved into a single
 * polygon from its member counties, with every county that belongs to no
 * CBSA drawn as itself.
 *
 * **Why this is a whole-country tier rather than something you drill into
 * from a state.** 43 of the 393 metropolitan areas cross state lines —
 * Washington DC spans DC/VA/MD/WV, New York spans NY/NJ/PA. Expanding one
 * state into "its metros" would slice each of those at the state border
 * and draw a fragment as though it were the whole area. The tier has to be
 * national for the geometry to be honest.
 *
 * **Why the polygons aren't stored.** `topojson.merge` dissolves the
 * shared borders between a CBSA's member counties at render time, from
 * arcs the county layer already ships. Legacy did the same thing
 * (`topojson.merge` over `metro_counties.json`) and also never stored a
 * metro polygon. What's committed is only the county-to-CBSA mapping
 * (`src/lib/geo/us-cbsa.ts`), which is a few dozen KB of text.
 *
 * Both metropolitan and micropolitan areas are dissolved, which is what
 * "CBSA" means and what legacy's own 935-entry file covered.
 */
export function loadUsMetroFeatures(): Promise<FeatureCollection<Geometry, UsMetroProperties>> {
  metroPromise ??= loadCountyTopology().then((topo) => {
    const geometries = topo.objects.counties.geometries;

    // Member geometries per CBSA, plus everything left over. Grouped in one
    // pass over the county list rather than a lookup per CBSA, since the
    // mapping is county -> area.
    const membersByCbsa = new Map<string, typeof geometries>();
    const unaffiliated: typeof geometries = [];
    for (const geometry of geometries) {
      const fips = String(geometry.id ?? "");
      if (!isAlbersUsaDrawable(fips)) continue;
      const code = cbsaCodeForCounty(fips);
      if (code === null) {
        unaffiliated.push(geometry);
        continue;
      }
      const bucket = membersByCbsa.get(code);
      if (bucket) bucket.push(geometry);
      else membersByCbsa.set(code, [geometry]);
    }

    const features: Feature<Geometry, UsMetroProperties>[] = [];

    for (const [code, members] of membersByCbsa) {
      const area = CBSA_AREAS[code];
      if (!area) continue;
      features.push({
        type: "Feature",
        // The CBSA code, so values can be keyed by it the same way county
        // features are keyed by FIPS.
        id: code,
        properties: { name: area.title, kind: area.kind },
        geometry: merge(topo, members as Parameters<typeof merge>[1]),
      });
    }

    for (const geometry of unaffiliated) {
      const decoded = feature(topo, geometry) as Feature<Geometry, UsCountyProperties>;
      features.push({
        ...decoded,
        properties: { name: decoded.properties?.name ?? "", kind: "county" },
      });
    }

    return { type: "FeatureCollection", features };
  });
  return metroPromise;
}

/** One metro-view map, ready to draw. `valuesById` is keyed by CBSA code
 * for a dissolved area and by county FIPS for everything else — see
 * `loadUsMetroFeatures`, which sets each feature's id accordingly. */
export function usMetroExpansion(
  features: FeatureCollection<Geometry, UsMetroProperties>,
  valuesById: ReadonlyMap<string, number>,
): GeoExpansion {
  return geoExpansion<UsMetroProperties>({
    key: "us-metros",
    label: "United States",
    features,
    getValue: (f) => valuesById.get(String(f.id)) ?? null,
    getLabel: (f) => f.properties.name,
    valueLabel: "days",
  });
}
