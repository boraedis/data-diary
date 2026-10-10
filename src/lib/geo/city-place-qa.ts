import type { Feature, Geometry } from "geojson";
import type { CityRootConfig, CitySuburbConfig } from "./city-config";
import {
  isPlaceInCity,
  resolveCityFeatureName,
  resolveCitySuburbByName,
  type CityPlaceRow,
  type CitySuburbFeature,
} from "./resolve-city-place";

/**
 * The shared QA-check core behind #293's diagnostic script
 * (scripts/find-misplaced-city-places.mjs) and the in-app QA modal on
 * /charts/city-heatmap alike — kept pure and DB-independent, same split
 * every other pure/fetch pairing in this app follows (see bin.ts's own
 * header), so it can be unit-tested and so the CLI script and the live
 * app can't drift into two different definitions of "misplaced."
 *
 * Why this needs its own check, distinct from getCityHeatmapData's own
 * neighborhood resolution: that function (src/lib/charts.ts) resolves a
 * place to a neighborhood purely by walking its catalog name_path against
 * the geometry's own feature names (resolveCityFeatureName) — it never
 * looks at the place's lat/lng at all. So the heatmap's choropleth fill
 * always agrees with the catalog's declared hierarchy, even when a
 * place's actual coordinates are wrong; only the destination dot
 * (plotted straight from lat/lng) would visually show up misplaced. This
 * module is the "does the declared neighborhood's polygon actually
 * contain the point" check, run as a batch rather than eyeballed off the
 * map.
 */

export type CityGeometryProperties = {
  root: string;
  name: string;
  /** Set on a suburban county's "Rest of <county>" backdrop (#281) — see
   * scripts/geo-fetch-suburbs.mjs. */
  remainder?: boolean;
};
export type CityGeometryFeature = Feature<Geometry, CityGeometryProperties>;

export type CityPlaceQaPlace = CityPlaceRow & { id: number; name: string; lat: number; lng: number };

export const CITY_PLACE_QA_KINDS = ["mismatch", "outside", "spelling", "unmapped"] as const;
export type CityPlaceQaFindingKind = (typeof CITY_PLACE_QA_KINDS)[number];

export function parseCityPlaceQaKind(value: unknown): CityPlaceQaFindingKind | null {
  return typeof value === "string" && (CITY_PLACE_QA_KINDS as readonly string[]).includes(value)
    ? (value as CityPlaceQaFindingKind)
    : null;
}

export type CityPlaceQaFinding = {
  placeId: number;
  placeName: string;
  namePath: string;
  kind: CityPlaceQaFindingKind;
  /** True for a place under one of the city's suburban regions (#281)
   * rather than one of its catalog roots. The two are fixed differently: a
   * name override only takes effect under the root it is saved against, so
   * the modal offers "Map name" for a suburb finding only when `actual` is
   * a suburb region, and for a root finding only when it is a catalog root. */
  suburb?: boolean;
  /** What the catalog's own hierarchy says, when it resolves at all. */
  declared: { root: string; featureName: string } | null;
  /** What the point actually falls inside, when it falls inside anything. */
  actual: { root: string; name: string } | null;
  /** Only set for "spelling" — the namePath segment that's the same
   * neighborhood as `actual` once case/whitespace/punctuation is
   * ignored, plus a ready-to-paste alias-table line for that city's own
   * <city>-names.ts (ignored by the in-app override path, which writes
   * to `cityNeighborhoodOverrides` instead — see city-heatmap-qa.ts). */
  suggestedAlias: { segment: string; aliasKey: string; aliasValue: string } | null;
};

// Case/whitespace/punctuation-insensitive comparison key, for telling a
// pure spelling/formatting difference (same neighborhood, different
// text) apart from a genuinely different name. Deliberately exact once
// canonicalized — no edit-distance/fuzzy matching, which risks calling a
// real coordinate error "just spelling" when a wrong neighborhood
// happens to have a similar name. A real typo or abbreviation (catalog
// "Marrieta St Artery" vs. GIS "Marietta Street Artery") canonicalizes to
// two different strings and surfaces as "unmapped" instead.
function canonicalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Every QA finding for one city's geocoded places under its catalog
 * root(s) — see `CityPlaceQaFindingKind`'s own doc comment for what each
 * kind means. A place whose declared neighborhood agrees with where its
 * point actually lands is not returned, and neither is a place with no
 * declared neighborhood whose point also lands nowhere (the ungeocoded/
 * no-matching-geometry case the heatmap chart already renders as an
 * uncoloured destination dot — this module can't add anything there).
 *
 * `normalize` is the caller's composed function — see
 * city-heatmap-qa.ts's own comment on why the DB-backed override layer
 * is folded in at the call site rather than here, keeping this module
 * itself free of any DB dependency.
 */
export function findCityPlaceQaFindings(
  places: readonly CityPlaceQaPlace[],
  roots: CityRootConfig[],
  geometryFeatures: readonly CityGeometryFeature[],
  geoContains: (feature: CityGeometryFeature, point: [number, number]) => boolean,
  normalize: (root: string, name: string) => string,
  /** The city's suburban regions, if it has any (#281). A suburb place is
   * credited to the municipality its catalog path names, so it can disagree
   * with its point exactly like a catalog-rooted one, and gets the same
   * "mismatch"/"outside" findings. Only those two kinds: a suburb place
   * with no catalog name matching a region falls back to its point, which
   * agrees with itself by construction. */
  suburbs?: { configs: readonly CitySuburbConfig[]; features: readonly CitySuburbFeature[] },
): CityPlaceQaFinding[] {
  const geometryNamesByRoot = new Map<string, Set<string>>();
  for (const f of geometryFeatures) {
    const { root, name } = f.properties;
    if (!geometryNamesByRoot.has(root)) geometryNamesByRoot.set(root, new Set());
    geometryNamesByRoot.get(root)!.add(name);
  }

  // A suburban county's remainder (#281) overlaps every place inside it,
  // so it only counts once no real feature contains the point.
  //
  // The city's own roots are searched before its suburbs. A suburb's Census
  // boundary can overlap the city's neighborhood layer by a sliver (Atlanta
  // beside Brookhaven or Druid Hills), and a place the catalog files under
  // the city should be judged against the city's polygons first; only a
  // point outside all of them is "in" a suburb.
  const rootNames = new Set(roots.map((r) => r.root));
  const ordered = [
    ...geometryFeatures.filter((f) => rootNames.has(f.properties.root)),
    ...geometryFeatures.filter((f) => !rootNames.has(f.properties.root)),
  ];
  function actualFeatureFor(point: [number, number]): CityGeometryProperties | null {
    let remainder: CityGeometryProperties | null = null;
    for (const f of ordered) {
      if (!geoContains(f, point)) continue;
      if (!f.properties.remainder) return f.properties;
      remainder ??= f.properties;
    }
    return remainder;
  }

  const findings: CityPlaceQaFinding[] = [];

  function pushSuburbFinding(place: CityPlaceQaPlace) {
    const declared = resolveCitySuburbByName(place, suburbs!.configs, suburbs!.features, normalize);
    if (!declared) return; // resolved by point (or not at all): nothing declared to disagree with
    const actual = actualFeatureFor([place.lng, place.lat]);
    if (actual && actual.root === declared.root && actual.name === declared.featureName) return;
    findings.push({
      placeId: place.id,
      placeName: place.name,
      namePath: place.namePath,
      kind: actual ? "mismatch" : "outside",
      suburb: true,
      declared,
      actual: actual ? { root: actual.root, name: actual.name } : null,
      suggestedAlias: null,
    });
  }

  for (const place of places) {
    if (!isPlaceInCity(place.idPath, roots)) {
      if (suburbs) pushSuburbFinding(place);
      continue;
    }

    const declared = resolveCityFeatureName(place, roots, geometryNamesByRoot, normalize);
    const point: [number, number] = [place.lng, place.lat];
    const actual = actualFeatureFor(point);

    if (declared === null && actual === null) continue; // nothing to say
    if (declared && actual && declared.root === actual.root && declared.featureName === actual.name) continue; // agrees

    if (declared && !actual) {
      findings.push({
        placeId: place.id,
        placeName: place.name,
        namePath: place.namePath,
        kind: "outside",
        declared,
        actual: null,
        suggestedAlias: null,
      });
    } else if (declared && actual) {
      findings.push({
        placeId: place.id,
        placeName: place.name,
        namePath: place.namePath,
        kind: "mismatch",
        declared,
        actual: { root: actual.root, name: actual.name },
        suggestedAlias: null,
      });
    } else if (!declared && actual) {
      const segments = place.namePath.split("/").filter(Boolean);
      const spellingSegment = segments.find((s) => canonicalize(s) === canonicalize(actual.name));
      findings.push({
        placeId: place.id,
        placeName: place.name,
        namePath: place.namePath,
        kind: spellingSegment ? "spelling" : "unmapped",
        declared: null,
        actual: { root: actual.root, name: actual.name },
        suggestedAlias: spellingSegment
          ? { segment: spellingSegment, aliasKey: spellingSegment.trim().toLowerCase(), aliasValue: actual.name }
          : null,
      });
    }
  }

  return findings;
}

export type CityNeighborhoodOverride = { root: string; rawName: string; geometryName: string };

/**
 * Layers a city's DB-backed overrides on top of its static
 * <city>-names.ts `normalize`: an override for (root, catalog spelling)
 * wins, anything without one falls through to the static table
 * unchanged.
 *
 * Composed at the call site rather than inside resolveCityFeatureName:
 * that function is deliberately pure and shared by three callers
 * (getCityHeatmapData, geo-build.mjs's catalog-coverage check, and the QA
 * check), and `normalize` was already an injected parameter — so wrapping
 * it changes what those callers pass, not what the shared resolution path
 * *is*. A build script with no database simply keeps passing the bare
 * static function.
 */
export function withCityNeighborhoodOverrides(
  baseNormalize: (root: string, name: string) => string,
  overrides: readonly CityNeighborhoodOverride[],
): (root: string, name: string) => string {
  if (overrides.length === 0) return baseNormalize;
  const byKey = new Map(overrides.map((o) => [`${o.root}\0${o.rawName}`, o.geometryName]));
  return (root, name) => byKey.get(`${root}\0${name.trim().toLowerCase()}`) ?? baseNormalize(root, name);
}
