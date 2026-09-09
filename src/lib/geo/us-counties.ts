import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import countiesTopoRaw from "us-atlas/counties-10m.json";

/**
 * Resolves a geocoded place to the US county containing it (#107), by
 * point-in-polygon against us-atlas's county geometry.
 *
 * **Why this isn't a namePath walk like every other resolver in this
 * folder.** #107's original plan was to resolve counties the way
 * `resolveUsStateName` resolves states — walk `places.namePath` for an
 * ancestor segment naming one. Checked against the real catalog before
 * building: of 1,347 US places, exactly two are county nodes (`USA/
 * Virginia/Henrico County/`, `USA/Goochland County/`). The hierarchy goes
 * state -> *city* -> neighborhood; there is simply no county tier to walk
 * to, and there never was. `buildTreeFromParents` can't help either — it
 * reshapes the same ancestry this walk would.
 *
 * A spatial join has no such problem, because it doesn't ask the catalog
 * anything: it asks the coordinates. That works here specifically because
 * geocoding coverage is near-total (`places.lat`/`lng` are set whenever an
 * address is, see geocodePlaceIfNeeded in catalog-admin.ts) — measured at
 * 5,357 of 5,359 US (day, place) pairs when this shipped.
 *
 * The tradeoff worth knowing: a spatial join is only as good as the
 * geocode. A point geocoded slightly offshore lands in no county at all
 * (three real cases in the current catalog: a Virginia Beach address out
 * in the Atlantic, a Chicago rooftop bar in Lake Michigan, and a "Gulf
 * Shores" filed under Florida that geocodes into the Gulf of Mexico).
 * Those resolve to null and are reported by the caller rather than
 * silently attached to the nearest county — a wrong county is worse than
 * an honest gap, and a nearest-polygon fallback would quietly paper over
 * exactly the bad geocodes worth fixing.
 */

type CountyProperties = { name: string };

// 10m, matching states-10m — us-atlas's only county resolution anyway.
// ~842KB, which is why this module is server-only in practice: it's
// imported by src/lib/charts.ts for the join, never by a chart component.
// The chart loads county *geometry* separately, and lazily, at the moment
// someone first drills into a state (see us-geo-levels.ts).
const countiesTopology = countiesTopoRaw as unknown as Topology<{
  counties: GeometryCollection<CountyProperties>;
}>;

export type UsCounty = {
  /** 5-digit county FIPS, zero-padded — e.g. "13121" for Fulton, Georgia. */
  fips: string;
  /** us-atlas's own feature name, used verbatim. Bare ("Fulton", not
   * "Fulton County") and deliberately left that way: the correct suffix
   * isn't uniform — Louisiana has parishes, Alaska has boroughs and census
   * areas, and Virginia's independent cities (Richmond, "51760") aren't
   * counties at all. Appending "County" would be wrong for all three. */
  name: string;
};

/** Decoded once per process, on first use rather than at import: parsing
 * and arc-resolving the whole county layer is the expensive part, and a
 * request that never touches county data shouldn't pay for it. */
let cachedCounties: Feature<Geometry, CountyProperties>[] | null = null;
let cachedByStateFips: Map<string, Feature<Geometry, CountyProperties>[]> | null = null;

function loadCounties() {
  if (cachedCounties && cachedByStateFips) return { all: cachedCounties, byState: cachedByStateFips };
  const all = feature(countiesTopology, countiesTopology.objects.counties).features;
  const byState = new Map<string, Feature<Geometry, CountyProperties>[]>();
  for (const county of all) {
    // A county's FIPS begins with its state's — see US_STATE_FIPS_BY_NAME.
    const stateFips = String(county.id).slice(0, 2);
    if (!byState.has(stateFips)) byState.set(stateFips, []);
    byState.get(stateFips)!.push(county);
  }
  cachedCounties = all;
  cachedByStateFips = byState;
  return { all, byState };
}

/**
 * The county containing `[lng, lat]`, or null if the point is inside no
 * county polygon at all.
 *
 * `stateFipsHint` — the state the *catalog* claims this place is in — is
 * checked first purely as an optimization, since it's right for the
 * overwhelming majority of places (1,330 of 1,345 when measured) and turns
 * a 3,231-polygon scan into a ~100-polygon one. It is only a hint: when it
 * misses, this still falls back to a nationwide scan rather than giving
 * up, because the disagreement is itself informative — 12 places in the
 * current catalog geocode to a county in a *different* state than their
 * namePath says, which is a real data-entry signal, not a reason to drop
 * their days.
 */
export function resolveCountyForPoint(lat: number, lng: number, stateFipsHint?: string | null): UsCounty | null {
  const { all, byState } = loadCounties();
  const point: [number, number] = [lng, lat];

  const hinted = stateFipsHint ? (byState.get(stateFipsHint) ?? []) : [];
  for (const county of hinted) {
    if (d3.geoContains(county, point)) return { fips: String(county.id), name: county.properties.name };
  }
  for (const county of all) {
    if (d3.geoContains(county, point)) return { fips: String(county.id), name: county.properties.name };
  }
  return null;
}
