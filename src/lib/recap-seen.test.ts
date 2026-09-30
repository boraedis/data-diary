import { describe, expect, it } from "vitest";
import { monthPeriod, yearPeriod } from "@/lib/recap";
import {
  countUnseen,
  findUnseenRecaps,
  periodFromRecapKey,
  recapPeriodKey,
} from "@/lib/recap-seen";

// Covers the pure half of the "new recap ready" badge (#518). The DB-backed
// getUnseenRecaps / markRecapSeen aren't covered here; see the PR for what
// was and wasn't verified live.

describe("recapPeriodKey / periodFromRecapKey", () => {
  it("round-trips a year and a month", () => {
    expect(recapPeriodKey(yearPeriod(2026))).toBe("2026");
    expect(recapPeriodKey(monthPeriod(2026, 3))).toBe("2026-03");
    expect(periodFromRecapKey("2026")).toEqual(yearPeriod(2026));
    expect(periodFromRecapKey("2026-03")).toEqual(monthPeriod(2026, 3));
  });

  it("has no key for an arbitrary window", () => {
    expect(recapPeriodKey({ start: "2025-06-10", end: "2025-07-09", label: "x" })).toBeNull();
  });

  it("rejects malformed keys", () => {
    for (const bad of ["", "26", "2026-13", "2026-00", "2026-3", "2026-03-01", "abcd"]) {
      expect(periodFromRecapKey(bad)).toBeNull();
    }
  });
});

describe("findUnseenRecaps", () => {
  const monthCounts = new Map([
    ["2025-11", 20],
    ["2025-12", 25],
    ["2026-01", 28],
    ["2026-02", 0],
    ["2026-03", 30],
  ]);
  const base = { monthCounts, seenKeys: new Set<string>(), baseline: "2025-12-01" };

  it("badges published, unopened months and years individually", () => {
    const unseen = findUnseenRecaps({ ...base, today: "2026-01-10" });
    // November published 2025-12-04 and December 2026-01-04 — both after the
    // baseline and both out by today.
    expect(unseen.months).toEqual(["2025-12", "2025-11"]);
    expect(unseen.years).toEqual([2025]);
  });

  it("does not badge a period still inside its grace window", () => {
    const unseen = findUnseenRecaps({ ...base, today: "2026-01-03" });
    expect(unseen.months).toEqual(["2025-11"]);
    expect(unseen.years).toEqual([]);
  });

  it("treats everything published on or before the baseline as seen", () => {
    const unseen = findUnseenRecaps({ ...base, baseline: "2026-01-04", today: "2026-01-10" });
    expect(unseen).toEqual({ years: [], months: [] });
  });

  it("clears exactly the recap that was opened", () => {
    const unseen = findUnseenRecaps({
      ...base,
      seenKeys: new Set(["2025-11"]),
      today: "2026-01-10",
    });
    expect(unseen.months).toEqual(["2025-12"]);
    expect(unseen.years).toEqual([2025]);
  });

  it("judges a year independently of its months", () => {
    const unseen = findUnseenRecaps({
      ...base,
      seenKeys: new Set(["2025"]),
      today: "2026-01-10",
    });
    expect(unseen.years).toEqual([]);
    expect(unseen.months).toEqual(["2025-12", "2025-11"]);
  });

  it("never badges a month with nothing logged", () => {
    const unseen = findUnseenRecaps({ ...base, baseline: "2000-01-01", today: "2026-09-30" });
    expect(unseen.months).not.toContain("2026-02");
  });

  it("badges nothing before anything is published", () => {
    const unseen = findUnseenRecaps({ ...base, today: "2025-11-15" });
    expect(unseen).toEqual({ years: [], months: [] });
  });

  it("counts every badged period", () => {
    expect(countUnseen({ years: [2025], months: ["2025-12", "2025-11"] })).toBe(3);
    expect(countUnseen({ years: [], months: [] })).toBe(0);
  });
});
