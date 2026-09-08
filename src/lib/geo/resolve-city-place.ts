import type { CityRootConfig } from "./city-config";

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
