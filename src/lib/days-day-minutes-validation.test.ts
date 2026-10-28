import { describe, expect, it, vi } from "vitest";
import { MAX_DAILY_MINUTES } from "@/lib/duration-limits";
import { validateTechnologyPayload, validateWorkPayload } from "@/lib/days";
import type { MockDb } from "@/lib/test-utils/mock-db";

// Covers the day-level minutes columns on the work and technology sections
// (workDurationMinutes, phone/laptop/instagram usage). Those validators
// used to accept any JavaScript number, so a negative, fractional or 30h
// reading saved as-is. The rules themselves live in `checkDayMinutes`
// (duration-limits.test.ts); these tests pin that the validators apply them
// and no longer drop a non-number silently.

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));

describe("validateWorkPayload: workDurationMinutes", () => {
  it("accepts a whole-minute duration within a day", () => {
    const r = validateWorkPayload({ workDurationMinutes: 480 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.workDurationMinutes).toBe(480);
  });

  it("accepts zero and an absent value (not recorded)", () => {
    const zero = validateWorkPayload({ workDurationMinutes: 0 });
    expect(zero.ok && zero.value.workDurationMinutes).toBe(0);
    const absent = validateWorkPayload({});
    expect(absent.ok && absent.value.workDurationMinutes).toBe(null);
  });

  it("rejects a negative duration", () => {
    const r = validateWorkPayload({ workDurationMinutes: -30 });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Work duration can't be -30 minutes") });
  });

  it("rejects more than a day", () => {
    const r = validateWorkPayload({ workDurationMinutes: MAX_DAILY_MINUTES + 60 });
    expect(r.ok).toBe(false);
  });

  it("rejects a fractional duration", () => {
    const r = validateWorkPayload({ workDurationMinutes: 7.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-number rather than saving it as null", () => {
    const r = validateWorkPayload({ workDurationMinutes: "480" });
    expect(r).toEqual({ ok: false, error: "Work duration must be a number of minutes" });
  });
});

describe("validateTechnologyPayload: usage minutes", () => {
  it("accepts whole-minute usage within a day for each device", () => {
    const r = validateTechnologyPayload({
      phoneUsageMinutes: 120,
      laptopUsageMinutes: 300,
      instagramUsageMinutes: 45,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        phoneUsageMinutes: 120,
        laptopUsageMinutes: 300,
        instagramUsageMinutes: 45,
      });
    }
  });

  it("leaves absent devices null", () => {
    const r = validateTechnologyPayload({ phoneUsageMinutes: 60 });
    expect(r.ok && r.value).toEqual({
      phoneUsageMinutes: 60,
      laptopUsageMinutes: null,
      instagramUsageMinutes: null,
    });
  });

  it("names the device when a reading is out of range", () => {
    expect(validateTechnologyPayload({ laptopUsageMinutes: MAX_DAILY_MINUTES + 1 })).toEqual({
      ok: false,
      error: expect.stringContaining("Laptop usage can't be"),
    });
    expect(validateTechnologyPayload({ instagramUsageMinutes: -1 })).toEqual({
      ok: false,
      error: expect.stringContaining("Instagram usage can't be -1 minutes"),
    });
  });

  it("rejects a non-number rather than saving it as null", () => {
    expect(validateTechnologyPayload({ phoneUsageMinutes: "lots" })).toEqual({
      ok: false,
      error: "Phone usage must be a number of minutes",
    });
  });
});
