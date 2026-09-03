import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mock-db";
import { validateHealthPayload, validatePeoplePayload, validatePlacesPayload, validateSleepPayload } from "@/lib/days";

// This file covers only the FK-existence and conditional-required rules
// added for #64 — validateHealthPayload/validatePeoplePayload/
// validatePlacesPayload each now issue a lookup query (via
// findMissingExerciseIds/findMissingPlaceIds/findMissingPersonIds in
// days.ts) to confirm a client-supplied id actually exists before it can
// reach the DB as an FK-constraint violation. The rest of days.ts's much
// larger validation surface is out of scope here — see #38's PR thread for
// why the mocked-drizzle-client strategy this file uses hasn't been
// extended to the rest of that file yet.

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));

describe("validateSleepPayload", () => {
  it("accepts both times present", () => {
    expect(validateSleepPayload({ sleepTime: "23:00", wakeTime: "07:00" }).ok).toBe(true);
  });

  it("accepts neither time present", () => {
    expect(validateSleepPayload({}).ok).toBe(true);
  });

  it("rejects sleepTime without wakeTime", () => {
    expect(validateSleepPayload({ sleepTime: "23:00" })).toEqual({
      ok: false,
      error: "Sleep time and wake time must be entered together",
    });
  });

  it("rejects wakeTime without sleepTime", () => {
    expect(validateSleepPayload({ wakeTime: "07:00" })).toEqual({
      ok: false,
      error: "Sleep time and wake time must be entered together",
    });
  });
});

describe("validateHealthPayload", () => {
  it("accepts a workout whose exercise and location both exist", async () => {
    dbState.current = createMockDb([[{ id: 5 }], [{ id: 9 }]]);
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5, locationId: 9 }] });
    expect(result.ok).toBe(true);
  });

  it("skips the location lookup entirely when no workout has one (no wasted DB call)", async () => {
    dbState.current = createMockDb([[{ id: 5 }]]); // only one queued result — a second DB call would throw
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5 }] });
    expect(result.ok).toBe(true);
  });

  it("rejects a workout referencing an exercise that doesn't exist", async () => {
    dbState.current = createMockDb([[]]); // exercises lookup finds nothing
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 999 }] });
    expect(result).toEqual({ ok: false, error: "Exercise not found: 999" });
  });

  it("rejects a workout referencing a location that doesn't exist", async () => {
    dbState.current = createMockDb([[{ id: 5 }], []]);
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5, locationId: 999 }] });
    expect(result).toEqual({ ok: false, error: "Location not found: 999" });
  });

  it("checks each referenced exercise id only once even if used by multiple workouts", async () => {
    dbState.current = createMockDb([[{ id: 5 }]]); // one queued result for one deduped lookup
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5 }, { exerciseId: 5 }],
    });
    expect(result.ok).toBe(true);
  });

  it("still rejects a malformed workout (missing exerciseId) before any DB lookup", async () => {
    dbState.current = createMockDb([]); // any DB call here would throw
    const result = await validateHealthPayload({ workouts: [{}] });
    expect(result).toEqual({ ok: false, error: "Every workout needs an exercise" });
  });
});

describe("validatePeoplePayload", () => {
  it("accepts an entry whose person exists", async () => {
    dbState.current = createMockDb([[{ id: 3 }]]);
    const result = await validatePeoplePayload({ entries: [{ valence: "positive", slot: 0, personId: 3 }] });
    expect(result.ok).toBe(true);
  });

  it("rejects an entry whose person doesn't exist", async () => {
    dbState.current = createMockDb([[]]);
    const result = await validatePeoplePayload({ entries: [{ valence: "positive", slot: 0, personId: 404 }] });
    expect(result).toEqual({ ok: false, error: "Person not found: 404" });
  });

  it("rejects invalid shape before any DB lookup", async () => {
    dbState.current = createMockDb([]); // any DB call here would throw
    const result = await validatePeoplePayload({ entries: [{ valence: "sideways", slot: 0, personId: 1 }] });
    expect(result).toEqual({ ok: false, error: "Invalid valence" });
  });
});

describe("validatePlacesPayload", () => {
  it("accepts an entry whose place exists", async () => {
    dbState.current = createMockDb([[{ id: 7 }]]);
    const result = await validatePlacesPayload({ entries: [{ slot: 0, placeId: 7 }] });
    expect(result.ok).toBe(true);
  });

  it("rejects an entry whose place doesn't exist", async () => {
    dbState.current = createMockDb([[]]);
    const result = await validatePlacesPayload({ entries: [{ slot: 0, placeId: 404 }] });
    expect(result).toEqual({ ok: false, error: "Place not found: 404" });
  });
});
