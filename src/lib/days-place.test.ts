import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MockDb } from "@/lib/test-utils/mock-db";
import { resolveGeoUpdate, updatePlaceCatalogEntry } from "@/lib/days";
import { geocodeAddress } from "@/lib/geocode";

// Pins #302's fix: editing a place's address used to null out its existing
// coordinates whenever the re-geocode attempt came back empty — a missing
// GOOGLE_MAPS_API_KEY, an address Google doesn't recognize, or a network
// hiccup, all silently wiped a place's previously-correct lat/lng. See
// resolveGeoUpdate's own doc comment in days.ts for the full story.
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

const EXISTING_ROW = { address: "Old Address", name: "Testland", parentId: null };

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
function createSetCapturingDb(selectResults: unknown[][], updateResults: unknown[][]): { db: MockDb; setCalls: Record<string, unknown>[] } {
  const selectQueue = [...selectResults];
  const updateQueue = [...updateResults];
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
    insert: () => readChain(undefined),
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

  it("omits lat/lng (keeps existing coordinates) when the address is cleared entirely", async () => {
    // Deliberate, and the same principle as the failure cases above rather
    // than an exception to it: clearing the address text doesn't mean the
    // coordinates are wrong — they may well have been hand-verified
    // separately — so blanking the address alone shouldn't blank them too.
    // geocodeOrNull(null) short-circuits to {lat: null, lng: null} without
    // ever calling geocodeAddress, and resolveGeoUpdate treats that
    // exactly like a failed re-geocode: nothing to write, existing values
    // stand.
    const { db, setCalls } = createSetCapturingDb([[EXISTING_ROW]], [[updatedRow({ address: null })]]);
    dbState.current = db;
    const { item, geocodeFailed } = await updatePlaceCatalogEntry(1, { ...BASE_INPUT, address: null });
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(setCalls[0]).not.toHaveProperty("lat");
    expect(setCalls[0]).not.toHaveProperty("lng");
    expect(item.lat).toBe(10);
    expect(item.lng).toBe(20);
    // Not "failed" — clearing the address is a deliberate action, not an
    // attempt that came up empty, so there's nothing to warn about.
    expect(geocodeFailed).toBe(false);
  });
});
