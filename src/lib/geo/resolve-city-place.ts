import type { CityRootConfig, CitySuburbConfig } from "./city-config";

export type CityPlaceRow = { idPath: string; namePath: string };

/**
 * Resolves a leaf catalog place to the city-heatmap geometry feature it
 * belongs to, by walking its idPath/namePath. The one place this walk is
 * implemented — shared by scripts/geo-build.mjs's catalog-coverage check
 * and src/lib/charts.ts's getCityHeatmapData, per #266's own note not to
 * write a third resolution path alongside getCountryVisitData's simpler
 * first-path-segment-only version.
 *
 * A place resolves to whichever of its namePath segments *after* a
 * matching root (once normalized) matches a real geometry feature name —
 * every segment gets checked, not just the first, because #177's cities
 * don't all sit one level below their root: NYC is root -> borough ->
 * neighborhood, every other city is root -> neighborhood directly.
 *
 * idPath (not namePath) is what identifies the matching root — a root's
 * own name can legitimately recur elsewhere in its own path (Dubai the
 * emirate containing Dubai the city), so name-matching alone picks the
 * wrong occurrence; id_path segments are unambiguous.
 */
export function resolveCityFeatureName(
  place: CityPlaceRow,
  roots: CityRootConfig[],
  geometryNamesByRoot: Map<string, Set<string>>,
  normalize: (root: string, name: string) => string,
): { root: string; featureName: string } | null {
  const idSegments = place.idPath.split("/").filter(Boolean);
  const nameSegments = place.namePath.split("/").filter(Boolean);

  for (const { root, rootId } of roots) {
    const rootIndex = idSegments.indexOf(String(rootId));
    if (rootIndex === -1) continue;
    const localSegments = nameSegments.slice(rootIndex + 1);
    const geometryNames = geometryNamesByRoot.get(root);
    if (!geometryNames) continue;
    for (const segment of localSegments) {
      const normalized = normalize(root, segment);
      if (geometryNames.has(normalized)) return { root, featureName: normalized };
    }
    return null; // this place's idPath passes through `root` but resolves to no feature
  }
  return null; // idPath doesn't pass through any of this city's roots at all
}

/**
 * Whether a place sits under any of a city's catalog roots at all —
 * independent of whether resolveCityFeatureName can also match it to a
 * drawn geometry feature. Deliberately the weaker, geometry-independent
 * half of that check, split out for the destination-marker overlay: a
 * place can genuinely be "in Atlanta" while its neighborhood has no
 * matching polygon (a real gap in the geometry/alias table, like
 * Atlanta's own Briarcliff Woods — see atlanta-names.ts), and the whole
 * point of showing it as a dot anyway is to make that gap visible on the
 * map instead of silently dropping the place.
 */
export function isPlaceInCity(idPath: string, roots: CityRootConfig[]): boolean {
  const idSegments = idPath.split("/").filter(Boolean);
  return roots.some((r) => idSegments.includes(String(r.rootId)));
}

/** A drawn suburban feature, as resolveCitySuburbFeature needs it: its
 * identity plus a point test. The test is injected (d3.geoContains in the
 * app) so this module stays geometry-library-free and unit-testable, the
 * same way city-place-qa.ts takes its `geoContains`. */
export type CitySuburbFeature = {
  root: string;
  name: string;
  /** The "Rest of <county>" backdrop — see scripts/geo-fetch-dc-suburbs.mjs.
   * It contains every point in its county, so it's only a match once every
   * real place has missed. */
  remainder?: boolean;
  contains: (point: [number, number]) => boolean;
  /** [[minLng, minLat], [maxLng, maxLat]], checked before `contains` so a
   * point in Istanbul costs four comparisons per feature, not a spherical
   * containment test. */
  bounds: [[number, number], [number, number]];
};

function inBounds(bounds: CitySuburbFeature["bounds"], [lng, lat]: [number, number]): boolean {
  return lng >= bounds[0][0] && lng <= bounds[1][0] && lat >= bounds[0][1] && lat <= bounds[1][1];
}

/**
 * Resolves a place to one of a city's suburban regions (#281) — see
 * CitySuburbConfig for why these go by coordinates rather than catalog
 * ancestry. Only for places under none of the city's catalog roots: the
 * caller tries resolveCityFeatureName first.
 *
 * A place is eligible for a region only when its idPath passes through
 * that region's `stateRootId`. Then:
 *
 * - **Geocoded**: the feature containing the point, places before the
 *   county remainder. The point wins over whatever town the catalog files
 *   it under, deliberately: suburban addresses use mailing-address towns,
 *   which don't follow real boundaries. A "Falls Church" address is far
 *   more often in Fairfax County (Idylwood, Lake Barcroft, Seven Corners)
 *   than in the two square miles of the City of Falls Church, and the
 *   catalog has no other way to say which.
 * - **Not geocoded**: falls back to the catalog's own words, the first
 *   namePath segment after the state that names a feature (via
 *   `normalize`, so aliases and the QA modal's overrides apply). A
 *   geocoded point that lands in no feature does *not* fall back: a point
 *   outside all five regions is in Loudoun or Richmond, whatever the
 *   catalog path says.
 */
export function resolveCitySuburbFeature(
  place: CityPlaceRow & { lat: number | null; lng: number | null },
  suburbs: readonly CitySuburbConfig[],
  features: readonly CitySuburbFeature[],
  normalize: (root: string, name: string) => string,
): { root: string; featureName: string } | null {
  const idSegments = place.idPath.split("/").filter(Boolean);
  const eligibleRoots = new Set(suburbs.filter((s) => idSegments.includes(String(s.stateRootId))).map((s) => s.root));
  if (eligibleRoots.size === 0) return null;
  const candidates = features.filter((f) => eligibleRoots.has(f.root));

  if (place.lat != null && place.lng != null) {
    const point: [number, number] = [place.lng, place.lat];
    let remainderHit: CitySuburbFeature | null = null;
    for (const f of candidates) {
      if (!inBounds(f.bounds, point) || !f.contains(point)) continue;
      if (!f.remainder) return { root: f.root, featureName: f.name };
      remainderHit ??= f;
    }
    return remainderHit ? { root: remainderHit.root, featureName: remainderHit.name } : null;
  }

  const nameSegments = place.namePath.split("/").filter(Boolean);
  for (const suburb of suburbs) {
    if (!eligibleRoots.has(suburb.root)) continue;
    const stateIndex = idSegments.indexOf(String(suburb.stateRootId));
    const names = new Set(candidates.filter((f) => f.root === suburb.root && !f.remainder).map((f) => f.name));
    for (const segment of nameSegments.slice(stateIndex + 1)) {
      const normalized = normalize(suburb.root, segment);
      if (names.has(normalized)) return { root: suburb.root, featureName: normalized };
    }
  }
  return null;
}
