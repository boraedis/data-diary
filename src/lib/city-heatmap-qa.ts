import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cityNeighborhoodOverrides, cityPlaceQaDismissals, places } from "@/db/schema";
import { CITIES, type CityKey } from "@/lib/geo/city-config";
import type { CitySuburbFeature } from "@/lib/geo/resolve-city-place";
import {
  findCityPlaceQaFindings,
  withCityNeighborhoodOverrides,
  type CityGeometryFeature,
  type CityNeighborhoodOverride,
  type CityGeometryProperties,
  type CityPlaceQaFinding,
  type CityPlaceQaFindingKind,
  type CityPlaceQaPlace,
} from "@/lib/geo/city-place-qa";
import atlantaTopo from "@/data/geo/atlanta.topo.json";
import dcMetroTopo from "@/data/geo/dc-metro.topo.json";
import dubaiTopo from "@/data/geo/dubai.topo.json";
import nycTopo from "@/data/geo/nyc.topo.json";
import istanbulTopo from "@/data/geo/istanbul.topo.json";

// Data layer for the city-heatmap QA modal (#293) — the DB-touching half
// of src/lib/geo/city-place-qa.ts's pure check, same pure/fetch split as
// everywhere else in this app.

const CITY_TOPOLOGIES: Record<CityKey, unknown> = {
  atlanta: atlantaTopo,
  "dc-metro": dcMetroTopo,
  dubai: dubaiTopo,
  nyc: nycTopo,
  istanbul: istanbulTopo,
};

// Decoded once per process per city (topojson -> GeoJSON is the
// expensive step, and the committed files never change at runtime).
const featureCache = new Map<CityKey, CityGeometryFeature[]>();

export function loadCityGeometryFeatures(cityKey: CityKey): CityGeometryFeature[] {
  const cached = featureCache.get(cityKey);
  if (cached) return cached;
  const topo = CITY_TOPOLOGIES[cityKey] as Topology<{ [key: string]: GeometryCollection<CityGeometryProperties> }>;
  const collection = feature(topo, topo.objects[cityKey]);
  const features = collection.features as unknown as CityGeometryFeature[];
  featureCache.set(cityKey, features);
  return features;
}

const suburbFeatureCache = new Map<CityKey, CitySuburbFeature[]>();

/** The city's suburban features (#281) in the shape
 * resolveCitySuburbFeature takes, with the point test and bounding box
 * computed once per process. Empty for a city with no `suburbs`. */
export function loadCitySuburbFeatures(cityKey: CityKey): CitySuburbFeature[] {
  const cached = suburbFeatureCache.get(cityKey);
  if (cached) return cached;
  const suburbRoots = new Set((CITIES[cityKey].suburbs ?? []).map((s) => s.root));
  const features = loadCityGeometryFeatures(cityKey)
    .filter((f) => suburbRoots.has(f.properties.root))
    .map(
      (f): CitySuburbFeature => ({
        root: f.properties.root,
        name: f.properties.name,
        remainder: f.properties.remainder === true,
        contains: (point) => d3.geoContains(f, point),
        bounds: d3.geoBounds(f),
      }),
    );
  suburbFeatureCache.set(cityKey, features);
  return features;
}

/** Override rows for one city, as the flat list the modal shows. */
export async function listCityNeighborhoodOverrides(cityKey: CityKey): Promise<CityNeighborhoodOverride[]> {
  const db = getDb();
  return db
    .select({
      root: cityNeighborhoodOverrides.root,
      rawName: cityNeighborhoodOverrides.rawName,
      geometryName: cityNeighborhoodOverrides.geometryName,
    })
    .from(cityNeighborhoodOverrides)
    .where(eq(cityNeighborhoodOverrides.cityKey, cityKey));
}

// Postgres "undefined_table". Drizzle wraps driver errors, so the code sits
// on `cause` (possibly more than one level down), not on the error itself.
export function isUndefinedTableError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === "42P01") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The override lookup for the heatmap chart itself, which, unlike the QA
 * modal, treats mappings as optional enrichment: with none available it
 * just colours by the static alias tables, exactly as it did before the
 * overrides existed. Tolerates the table not existing yet, because a
 * production schema change waits on a manual migration approval and the
 * code that reads it can deploy first; without this, that window would
 * take the whole heatmap page down over a feature it doesn't need to
 * render. Only that one error is swallowed; anything else still throws.
 * The QA modal deliberately keeps using `listCityNeighborhoodOverrides`,
 * so an unmigrated database surfaces there as an error rather than an
 * empty list.
 */
export async function listCityNeighborhoodOverridesIfAvailable(cityKey: CityKey): Promise<CityNeighborhoodOverride[]> {
  try {
    return await listCityNeighborhoodOverrides(cityKey);
  } catch (err) {
    if (isUndefinedTableError(err)) return [];
    throw err;
  }
}

/**
 * What the QA routes should tell the client when a handler throws. A route
 * handler that throws gives the browser an *empty* 500 in production, which
 * the modal then reports as "Unexpected end of JSON input" and nothing
 * else, so the routes catch and answer with a reason instead. The one
 * failure worth naming is the unmigrated database: the two QA tables ship
 * with a schema push that lags the code (see
 * listCityNeighborhoodOverridesIfAvailable), and "run the migration" is a
 * very different fix from anything else that can go wrong here.
 */
export function describeQaFailure(err: unknown): { status: number; error: string } {
  if (isUndefinedTableError(err)) {
    return {
      status: 503,
      error:
        "The place-check tables don't exist in this database yet (city_place_qa_dismissals, city_neighborhood_overrides). Run the schema push against it (npx drizzle-kit push, or npm run dev:pr for a PR database).",
    };
  }
  return { status: 500, error: err instanceof Error && err.message ? err.message : "Unexpected server error" };
}

export type CityPlaceQaReport = {
  cityKey: CityKey;
  open: CityPlaceQaFinding[];
  /** Findings marked "intended" — kept visible (collapsed in the modal)
   * so a dismissal can be undone rather than being a one-way door. */
  dismissed: CityPlaceQaFinding[];
  overrides: CityNeighborhoodOverride[];
  /** Every polygon name per root, for the modal's "map to polygon"
   * picker. */
  geometryNames: { root: string; names: string[] }[];
  /** Which of those roots are the city's suburban regions rather than its
   * catalog roots — see CityPlaceQaFinding.suburb. */
  suburbRoots: string[];
};

export async function getCityPlaceQaReport(cityKey: CityKey): Promise<CityPlaceQaReport> {
  const db = getDb();
  const city = CITIES[cityKey];
  const geometryFeatures = loadCityGeometryFeatures(cityKey);

  const [placeRows, overrides, dismissalRows] = await Promise.all([
    db
      .select({ id: places.id, name: places.name, idPath: places.idPath, namePath: places.namePath, lat: places.lat, lng: places.lng })
      .from(places)
      .where(and(isNotNull(places.lat), isNotNull(places.lng), isNotNull(places.idPath), isNotNull(places.namePath))),
    listCityNeighborhoodOverrides(cityKey),
    db.select({ placeId: cityPlaceQaDismissals.placeId, kind: cityPlaceQaDismissals.kind }).from(cityPlaceQaDismissals),
  ]);

  const qaPlaces: CityPlaceQaPlace[] = placeRows.flatMap((p) =>
    p.idPath !== null && p.namePath !== null && p.lat !== null && p.lng !== null
      ? [{ id: p.id, name: p.name, idPath: p.idPath, namePath: p.namePath, lat: p.lat, lng: p.lng }]
      : [],
  );

  const findings = findCityPlaceQaFindings(
    qaPlaces,
    city.sources,
    geometryFeatures,
    (f, point) => d3.geoContains(f, point),
    withCityNeighborhoodOverrides(city.normalize, overrides),
    city.suburbs?.length ? { configs: city.suburbs, features: loadCitySuburbFeatures(cityKey) } : undefined,
  );

  const dismissedKeys = new Set(dismissalRows.map((d) => `${d.placeId}:${d.kind}`));
  const open: CityPlaceQaFinding[] = [];
  const dismissed: CityPlaceQaFinding[] = [];
  for (const finding of findings) {
    (dismissedKeys.has(`${finding.placeId}:${finding.kind}`) ? dismissed : open).push(finding);
  }

  const namesByRoot = new Map<string, string[]>();
  for (const f of geometryFeatures) {
    const list = namesByRoot.get(f.properties.root) ?? [];
    list.push(f.properties.name);
    namesByRoot.set(f.properties.root, list);
  }
  const geometryNames = [...namesByRoot.entries()].map(([root, names]) => ({ root, names: names.sort((a, b) => a.localeCompare(b)) }));

  return { cityKey, open, dismissed, overrides, geometryNames, suburbRoots: (city.suburbs ?? []).map((s) => s.root) };
}

export async function dismissCityPlaceQaFinding(placeId: number, kind: CityPlaceQaFindingKind): Promise<void> {
  const db = getDb();
  await db.insert(cityPlaceQaDismissals).values({ placeId, kind }).onConflictDoNothing();
}

export async function undismissCityPlaceQaFinding(placeId: number, kind: CityPlaceQaFindingKind): Promise<void> {
  const db = getDb();
  await db
    .delete(cityPlaceQaDismissals)
    .where(and(eq(cityPlaceQaDismissals.placeId, placeId), eq(cityPlaceQaDismissals.kind, kind)));
}

export type AddOverrideResult = { ok: true } | { ok: false; error: string };

/**
 * Upserts an override, after checking the target polygon really exists
 * under that root in the city's committed geometry — the one place a
 * typo'd or stale `geometryName` could otherwise be saved silently (see
 * `cityNeighborhoodOverrides`' own comment on why it isn't a foreign
 * key). Stored lowercased and trimmed, matching the static alias
 * tables' own key shape.
 */
export async function addCityNeighborhoodOverride(input: {
  cityKey: CityKey;
  root: string;
  rawName: string;
  geometryName: string;
}): Promise<AddOverrideResult> {
  const rawName = input.rawName.trim().toLowerCase();
  if (!rawName) return { ok: false, error: "Catalog name is required" };
  // A suburban region's root is as valid a target as a catalog root: the
  // suburb resolver reads overrides keyed by the region it is matching.
  const { sources, suburbs = [] } = CITIES[input.cityKey];
  if (![...sources, ...suburbs].some((s) => s.root === input.root)) {
    return { ok: false, error: `Unknown root "${input.root}" for ${CITIES[input.cityKey].label}` };
  }
  const exists = loadCityGeometryFeatures(input.cityKey).some(
    (f) => f.properties.root === input.root && f.properties.name === input.geometryName,
  );
  if (!exists) return { ok: false, error: `No polygon named "${input.geometryName}" under ${input.root}` };

  const db = getDb();
  await db
    .insert(cityNeighborhoodOverrides)
    .values({ cityKey: input.cityKey, root: input.root, rawName, geometryName: input.geometryName })
    .onConflictDoUpdate({
      target: [cityNeighborhoodOverrides.cityKey, cityNeighborhoodOverrides.root, cityNeighborhoodOverrides.rawName],
      set: { geometryName: input.geometryName },
    });
  return { ok: true };
}

export async function removeCityNeighborhoodOverride(input: { cityKey: CityKey; root: string; rawName: string }): Promise<void> {
  const db = getDb();
  await db
    .delete(cityNeighborhoodOverrides)
    .where(
      and(
        eq(cityNeighborhoodOverrides.cityKey, input.cityKey),
        eq(cityNeighborhoodOverrides.root, input.root),
        eq(cityNeighborhoodOverrides.rawName, input.rawName.trim().toLowerCase()),
      ),
    );
}
