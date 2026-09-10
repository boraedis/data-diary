import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MockDb } from "@/lib/test-utils/mock-db";
import { buildFallbackGeocodeQueryFromPath, createPlaceCatalogEntry, resolveGeoUpdate, updatePlaceCatalogEntry } from "@/lib/days";
import { geocodeAddress } from "@/lib/geocode";

// Pins two related #302 fixes in updatePlaceCatalogEntry:
//
// 1. Editing a place's address used to null out its existing coordinates
//    whenever the re-geocode attempt came back empty — a missing
//    GOOGLE_MAPS_API_KEY, an address Google doesn't recognize, or a
//    network hiccup, all silently wiped a place's previously-correct
//    lat/lng. See resolveGeoUpdate's own doc comment in days.ts.
// 2. A place with no address at all (a friend's house, a trailhead) used
//    to never get geocoded — now falls back to a "<name>, <city>,
//    <state>, <country>" search built from its own name and ancestor
//    path. See buildFallbackGeocodeQuery(FromPath)'s doc comment.
//
// Same mocked-drizzle-client strategy days-validation.test.ts uses (see
// that file's own header for why); this one also mocks @/lib/geocode,
// since updatePlaceCatalogEntry's geocoding step is the thing under test.

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: vi.fn() }));

beforeEach(() => {
  vi.mocked(geocodeAddress).mockReset();
});

describe("resolveGeoUpdate", () => {
  it("writes the new coordinates when the address changed and geocoding succeeded", () => {
    expect(resolveGeoUpdate(true, { lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
  });

  it("writes nothing when the address didn't change, regardless of what geo holds", () => {
    // A caller that skipped geocoding altogether passes `geo: null` here
    // (see updatePlaceCatalogEntry) — but even a stray non-null value must
    // not leak through when nothing was supposed to change.
    expect(resolveGeoUpdate(false, null)).toEqual({});
    expect(resolveGeoUpdate(false, { lat: 1, lng: 2 })).toEqual({});
  });

  it("writes nothing — not null — when the address changed but geocoding came back empty", () => {
    // The exact bug: geocodeOrNull never returns `null` itself, only
    // `{lat: null, lng: null}` on failure, so a truthy-object check alone
    // (the old `geo ? {...} : {}`) always fired. This is what must return
    // `{}` instead of `{lat: null, lng: null}`.
    expect(resolveGeoUpdate(true, { lat: null, lng: null })).toEqual({});
  });

  it("writes nothing when only one coordinate resolved", () => {
    // Shouldn't happen in practice (Google returns both or neither), but a
    // half-written pair is exactly the kind of corrupt state this function
    // exists to never produce.
    expect(resolveGeoUpdate(true, { lat: 1, lng: null })).toEqual({});
    expect(resolveGeoUpdate(true, { lat: null, lng: 2 })).toEqual({});
  });

  it("writes nothing when no geocode attempt was made at all", () => {
    expect(resolveGeoUpdate(true, null)).toEqual({});
  });
});

describe("buildFallbackGeocodeQueryFromPath", () => {
  it("falls back to just the name when there's no ancestor path (a root place)", () => {
    expect(buildFallbackGeocodeQueryFromPath("USA", null)).toBe("USA");
  });

  it("joins name + up to 3 ancestors, most-specific-first", () => {
    // namePath is root-first ("country/state/city/..."); the query itself
    // should read the way a person would type it, city first.
    expect(buildFallbackGeocodeQueryFromPath("Georgia Tech", "USA/Georgia/Atlanta/")).toBe(
      "Georgia Tech, Atlanta, Georgia, USA"
    );
  });

  it("uses whatever ancestors exist when there are fewer than 3", () => {
    expect(buildFallbackGeocodeQueryFromPath("Atlanta", "USA/Georgia/")).toBe("Atlanta, Georgia, USA");
  });

  it("stops at the top 3 levels from the root, even when the place sits deeper than that", () => {
    // "Treasurers" is 5 levels down (USA/Georgia/Atlanta/Georgia Tech/Delta
    // Tau Delta/Treasurers) — only country/state/city should make it in,
    // not "Georgia Tech" or "Delta Tau Delta".
    expect(buildFallbackGeocodeQueryFromPath("Treasurers", "USA/Georgia/Atlanta/Georgia Tech/Delta Tau Delta/")).toBe(
      "Treasurers, Atlanta, Georgia, USA"
    );
  });
});

// A root ("Region" -> "Country") place with `parentId: null` in the input
// — assertValidRoot requires this shape whenever the target parentId is
// null, and it's also what keeps updatePlaceCatalogEntry's own DB call
// count small and predictable for these tests: passing a non-null
// parentId would additionally trigger getPlaceDescendantIds' own
// (variable-length, BFS) query sequence, which isn't what this file is
// pinning down. Name is also left unchanged from EXISTING_ROW below, so
// `pathAffectingChange` is false and there's exactly one `db.update(...)`
// call to observe — not two.
const BASE_INPUT = {
  name: "Testland",
  alias: null,
  address: "Old Address",
  category: "Region",
  subcategory: "Country",
  parentId: null,
  subregionName: null,
  color: "#112233",
  metroId: null,
};

// Existing lat/lng (10, 20) matches updatedRow()'s own defaults below, so
// a test that doesn't override either represents "this place already has
// coordinates, saved earlier" — the baseline the trigger-condition tests
// further down build off of.
const EXISTING_ROW = { address: "Old Address", name: "Testland", parentId: null, lat: 10, lng: 20 };

function updatedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "Testland",
    alias: null,
    address: "Old Address",
    category: "Region",
    subcategory: "Country",
    parentId: null,
    subregionName: null,
    color: "#112233",
    idPath: "1/",
    namePath: "Testland/",
    metroId: null,
    lat: 10,
    lng: 20,
    ...overrides,
  };
}

/**
 * A `db.update(places).set(arg)` records `arg` into `setCalls` before
 * resolving — everything else behaves like `createMockDb`'s own chain
 * (`select` and the rest just hand back the next queued result).
 *
 * `createMockDb` alone can't verify this fix: its `update()...set()...`
 * chain is a no-op that ignores whatever `set` is called with and just
 * returns whatever result was queued for it — so a test built only on the
 * *returned* row can't tell a correct `resolveGeoUpdate(...)` spread apart
 * from the original bug's `geo ? {...} : {}`, since either way the queued
 * row is whatever the test hardcoded. Capturing the actual `.set()`
 * argument is what makes these tests test the fix rather than the mock.
 */
function createSetCapturingDb(
  selectResults: unknown[][],
  updateResults: unknown[][],
  insertResults: unknown[][] = []
): { db: MockDb; setCalls: Record<string, unknown>[] } {
  const selectQueue = [...selectResults];
  const updateQueue = [...updateResults];
  const insertQueue = [...insertResults];
  const setCalls: Record<string, unknown>[] = [];

  function readChain(result: unknown) {
    const resolved = Promise.resolve(result);
    const target: Record<string, unknown> = {
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    const proxy: Record<string, unknown> = new Proxy(target, {
      get(t, prop, receiver) {
        if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver);
        return () => proxy;
      },
    });
    return proxy;
  }

  function updateChain(result: unknown) {
    const resolved = Promise.resolve(result);
    const target: Record<string, unknown> = {
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    const proxy: Record<string, unknown> = new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === "set") {
          return (arg: Record<string, unknown>) => {
            setCalls.push(arg);
            return proxy;
          };
        }
        if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver);
        return () => proxy;
      },
    });
    return proxy;
  }

  const db: MockDb = {
    select: () => readChain(selectQueue.shift()),
    insert: () => readChain(insertQueue.shift()),
    update: () => updateChain(updateQueue.shift()),
    delete: () => readChain(undefined),
  };
  return { db, setCalls };
}

describe("updatePlaceCatalogEntry", () => {
  it("does not call geocodeAddress at all when the address is unchanged", async () => {
    const { db, setCalls } = createSetCapturingDb([[EXISTING_ROW]], [[updatedRow()]]);
    dbState.current = db;
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, BASE_INPUT);
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(setCalls[0]).not.toHaveProperty("lat");
    expect(setCalls[0]).not.toHaveProperty("lng");
    expect(item.lat).toBe(10);
    expect(item.lng).toBe(20);
    expect(geocodeFailed).toBe(false);
  });

  it("writes the new coordinates when the address changed and geocoding succeeded", async () => {
    const { db, setCalls } = createSetCapturingDb(
      [[EXISTING_ROW]],
      [[updatedRow({ address: "New Address", lat: 33.7, lng: -84.4 })]]
    );
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue({ lat: 33.7, lng: -84.4 });
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: "New Address" });
    expect(setCalls[0]).toMatchObject({ lat: 33.7, lng: -84.4 });
    expect(item.lat).toBe(33.7);
    expect(item.lng).toBe(-84.4);
    expect(geocodeFailed).toBe(false);
  });

  it("#302: the SQL update omits lat/lng entirely when a re-geocode fails — it never asks to null them", async () => {
    const { db, setCalls } = createSetCapturingDb([[EXISTING_ROW]], [[updatedRow({ address: "Unrecognizable Address" })]]);
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue(null); // Google: ZERO_RESULTS
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, {
      ...BASE_INPUT,
      address: "Unrecognizable Address",
    });
    // The actual bug, pinned directly against what was sent to Postgres —
    // not against a canned mock row that merely happens to still say 10/20.
    expect(setCalls[0]).not.toHaveProperty("lat");
    expect(setCalls[0]).not.toHaveProperty("lng");
    expect(item.lat).toBe(10);
    expect(item.lng).toBe(20);
    expect(geocodeFailed).toBe(true);
  });

  it("#302: same omission when geocoding throws (e.g. no API key)", async () => {
    const { db, setCalls } = createSetCapturingDb([[EXISTING_ROW]], [[updatedRow({ address: "New Address" })]]);
    dbState.current = db;
    vi.mocked(geocodeAddress).mockRejectedValue(new Error("GOOGLE_MAPS_API_KEY is not set"));
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: "New Address" });
    expect(setCalls[0]).not.toHaveProperty("lat");
    expect(setCalls[0]).not.toHaveProperty("lng");
    expect(item.lat).toBe(10);
    expect(item.lng).toBe(20);
    expect(geocodeFailed).toBe(true);
  });

  it("clearing the address tries the name+path fallback rather than skipping geocoding", async () => {
    // Clearing the address still counts as an address change, so it's
    // worth at least trying the fallback for a place that might not need
    // a street address at all — see the "needsGeocodeAttempt" comment in
    // updatePlaceCatalogEntry. BASE_INPUT is a root place (parentId:
    // null), so the fallback query is just the name, with no ancestors to
    // add — verified against the actual geocodeAddress call, not assumed.
    const { db, setCalls } = createSetCapturingDb([[EXISTING_ROW]], [[updatedRow({ address: null, lat: 1, lng: 2 })]]);
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue({ lat: 1, lng: 2 });
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: null });
    expect(geocodeAddress).toHaveBeenCalledWith("Testland");
    expect(setCalls[0]).toMatchObject({ lat: 1, lng: 2 });
    expect(item.lat).toBe(1);
    expect(item.lng).toBe(2);
    expect(geocodeFailed).toBe(false);
  });

  it("clearing the address, when the fallback also fails, keeps the existing coordinates rather than nulling them", async () => {
    // Same #302 protection as the address-based failure cases above, just
    // reached via the fallback path instead of a typed address.
    const { db, setCalls } = createSetCapturingDb([[EXISTING_ROW]], [[updatedRow({ address: null })]]);
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue(null); // Google: ZERO_RESULTS for "Testland" alone
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: null });
    expect(setCalls[0]).not.toHaveProperty("lat");
    expect(setCalls[0]).not.toHaveProperty("lng");
    expect(item.lat).toBe(10);
    expect(item.lng).toBe(20);
    expect(geocodeFailed).toBe(true);
  });

  it("skips geocoding when the address is already blank, coordinates already exist, and nothing else changed", async () => {
    // The "don't re-fire needlessly" half of the fallback: EXISTING_ROW
    // already has lat/lng, and this save is address-blank-to-blank with
    // the same name/parent — no addressChanged, no pathAffectingChange,
    // coordinates already present, so there's nothing worth re-attempting.
    const blankExisting = { ...EXISTING_ROW, address: null };
    const { db, setCalls } = createSetCapturingDb([[blankExisting]], [[updatedRow({ address: null })]]);
    dbState.current = db;
    const { geocodeFailed } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: null });
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(setCalls[0]).not.toHaveProperty("lat");
    expect(setCalls[0]).not.toHaveProperty("lng");
    expect(geocodeFailed).toBe(false);
  });

  it("re-tries the fallback on a rename, even though the address was already blank and coordinates already exist", async () => {
    // A rename changes what the fallback query itself would search for
    // (the place's own name is the first segment), so it's worth trying
    // again even though neither addressChanged nor "no coordinates yet"
    // would otherwise trigger it.
    // A rename is also a path-affecting change, so updatePlaceCatalogEntry
    // issues a second db.update(...) after this one, to write the place's
    // own recomputed idPath/namePath (and, since it's a root place with no
    // parent, skips the fetchPlacePathParts select that a non-root rename
    // would also need) — queue a result for that second update too.
    // cascadePlacePaths then looks for this (now-renamed) place's own
    // children to propagate the path update to — an empty result ends
    // that BFS after one query, since this place has none.
    const blankExisting = { ...EXISTING_ROW, address: null };
    const { db, setCalls } = createSetCapturingDb(
      [[blankExisting], []],
      [[updatedRow({ address: null, name: "New Name", lat: 5, lng: 6 })], [updatedRow({ name: "New Name", lat: 5, lng: 6 })]]
    );
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue({ lat: 5, lng: 6 });
    const { item } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, name: "New Name", address: null });
    expect(geocodeAddress).toHaveBeenCalledWith("New Name");
    expect(setCalls[0]).toMatchObject({ lat: 5, lng: 6 });
    expect(item.lat).toBe(5);
    expect(item.lng).toBe(6);
  });

  it("still tries the fallback for a place that's never had coordinates, even on an unrelated edit", async () => {
    // No address, no coordinates, and this save doesn't touch name/parent
    // at all (just, say, a color change via BASE_INPUT) — worth trying at
    // least once rather than leaving it permanently unresolved.
    const neverGeocoded = { ...EXISTING_ROW, address: null, lat: null, lng: null };
    const { db, setCalls } = createSetCapturingDb(
      [[neverGeocoded]],
      [[updatedRow({ address: null, lat: 7, lng: 8 })]]
    );
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue({ lat: 7, lng: 8 });
    const { item } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: null });
    expect(geocodeAddress).toHaveBeenCalledWith("Testland");
    expect(setCalls[0]).toMatchObject({ lat: 7, lng: 8 });
    expect(item.lat).toBe(7);
    expect(item.lng).toBe(8);
  });
});

describe("createPlaceCatalogEntry", () => {
  it("uses the name+path fallback for a brand-new place with no address", async () => {
    // Root place (parentId: null), so the fallback query is just the
    // trimmed name — no ancestor select needed, and no existing
    // coordinates for a failed attempt to protect either way.
    const { db } = createSetCapturingDb(
      [],
      [[{ id: 1, name: "Testland", idPath: "1/", namePath: "Testland/", lat: 40, lng: -70 }]],
      [[{ id: 1, name: "Testland", parentId: null, lat: 40, lng: -70 }]]
    );
    dbState.current = db;
    vi.mocked(geocodeAddress).mockResolvedValue({ lat: 40, lng: -70 });
    const created = await createPlaceCatalogEntry({ ...BASE_INPUT, address: null });
    expect(geocodeAddress).toHaveBeenCalledWith("Testland");
    expect(created.lat).toBe(40);
    expect(created.lng).toBe(-70);
  });
});
