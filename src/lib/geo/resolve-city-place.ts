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
 * matching root (once normalized) matches a real geometry feature name
 * (or "Name (Parent segment)", for a name qualified by the one above it) —
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
    for (const [i, segment] of localSegments.entries()) {
      const normalized = normalize(root, segment);
      // A name that repeats within a root is stored qualified by the
      // segment above it, "Name (Parent)" — Istanbul's mahalles, where
      // "Cumhuriyet" is a neighborhood of dozens of districts. Tried
      // before the bare name, and the bare name is not a feature at all
      // for such a name, so a mahalle can't land in a namesake elsewhere.
      if (i > 0) {
        const qualified = `${normalized} (${normalize(root, localSegments[i - 1])})`;
        if (geometryNames.has(qualified)) return { root, featureName: qualified };
      }
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
  /** The "Rest of <county>" backdrop — see scripts/geo-fetch-suburbs.mjs.
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
 * CitySuburbConfig for why these have no catalog subtree. Only for places
 * under none of the city's catalog roots: the caller tries
 * resolveCityFeatureName first.
 *
 * A place is eligible for a region only when its idPath passes through that
 * region's `stateRootId`. Then, in order:
 *
 * 1. **The catalog's own words.** The first namePath segment after the
 *    state that names a feature (via `normalize`, so aliases and the QA
 *    modal's overrides apply) is the answer, geocoded or not. This is the
 *    same rule the city's own neighborhoods follow, and deliberately so: a
 *    place is credited to the municipality or neighborhood the catalog says
 *    it is in, so a wrong coordinate shows up as a dot sitting in the wrong
 *    place against the right polygon's colour, instead of quietly moving the
 *    place into whichever polygon the bad coordinate lands in. (This used
 *    to go the other way, point first, on the theory that suburban mailing
 *    towns don't follow real boundaries. They don't, but hiding the
 *    disagreement was worse than showing it.) When one name belongs to
 *    several regions (Mountain Park is a town in both Fulton and Gwinnett
 *    counties), the point picks between *those*, falling back to the first.
 * 2. **The point**, when no segment names a feature (a mailing-address town
 *    that isn't a Census place, or an area like Cumberland): the feature
 *    containing it, places before the county remainder. A geocoded point
 *    that lands in no feature does *not* fall back to anything: a point
 *    outside every region is in another county, whatever the catalog path
 *    says.
 */
/**
 * The first step of resolveCitySuburbFeature on its own: the region the
 * place's catalog path names, ignoring coordinates entirely (apart from
 * choosing between same-named regions when it has any). Split out because
 * the place check needs to know what the catalog *declares* separately from
 * where the point lands, to tell the two apart.
 *
 * A county's "Rest of ..." backdrop never matches a bare catalog segment,
 * but does when `normalize` actually changed the segment: an alias or a QA
 * override pointing a name at it is an explicit choice (the place check's
 * "Map name" does exactly that), not a coincidence.
 */
export function resolveCitySuburbByName(
  place: CityPlaceRow & { lat: number | null; lng: number | null },
  suburbs: readonly CitySuburbConfig[],
  features: readonly CitySuburbFeature[],
  normalize: (root: string, name: string) => string,
): { root: string; featureName: string } | null {
  const idSegments = place.idPath.split("/").filter(Boolean);
  const eligible = suburbs.filter((s) => idSegments.includes(String(s.stateRootId)));
  if (eligible.length === 0) return null;
  const eligibleRoots = new Set(eligible.map((s) => s.root));
  const candidates = features.filter((f) => eligibleRoots.has(f.root));
  const hasPoint = place.lat != null && place.lng != null;
  const point: [number, number] = [place.lng ?? 0, place.lat ?? 0];

  const nameSegments = place.namePath.split("/").filter(Boolean);
  const stateIndex = Math.min(...eligible.map((s) => idSegments.indexOf(String(s.stateRootId))));
  for (const segment of nameSegments.slice(stateIndex + 1)) {
    const named = candidates.filter((f) => {
      const normalized = normalize(f.root, segment);
      return f.name === normalized && (!f.remainder || normalized !== segment);
    });
    if (named.length === 0) continue;
    const pick = (hasPoint ? named.find((f) => inBounds(f.bounds, point) && f.contains(point)) : undefined) ?? named[0];
    return { root: pick.root, featureName: pick.name };
  }
  return null;
}

export function resolveCitySuburbFeature(
  place: CityPlaceRow & { lat: number | null; lng: number | null },
  suburbs: readonly CitySuburbConfig[],
  features: readonly CitySuburbFeature[],
  normalize: (root: string, name: string) => string,
): { root: string; featureName: string } | null {
  const idSegments = place.idPath.split("/").filter(Boolean);
  const eligible = suburbs.filter((s) => idSegments.includes(String(s.stateRootId)));
  if (eligible.length === 0) return null;
  const eligibleRoots = new Set(eligible.map((s) => s.root));
  const candidates = features.filter((f) => eligibleRoots.has(f.root));
  const hasPoint = place.lat != null && place.lng != null;
  const point: [number, number] = [place.lng ?? 0, place.lat ?? 0];

  const byName = resolveCitySuburbByName(place, suburbs, features, normalize);
  if (byName) return byName;

  if (!hasPoint) return null;
  let remainderHit: CitySuburbFeature | null = null;
  for (const f of candidates) {
    if (!inBounds(f.bounds, point) || !f.contains(point)) continue;
    if (!f.remainder) return { root: f.root, featureName: f.name };
    remainderHit ??= f;
  }
  return remainderHit ? { root: remainderHit.root, featureName: remainderHit.name } : null;
}
