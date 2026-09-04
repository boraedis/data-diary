import { describe, expect, it } from "vitest";
import { computeAgeRegions } from "@/lib/charts";

// Covers computeAgeRegions' own logic (issue #117 follow-up: Age regions
// on the weight chart) — the one piece of non-trivial, easily-isolated
// pure logic charts.ts gained for this. The DB-backed fetchers alongside
// it were verified live instead; see the PR for that record.

describe("computeAgeRegions", () => {
  it("produces one region per full birthday-to-birthday year", () => {
    const regions = computeAgeRegions("2000-01-01", new Date(2003, 0, 1));
    expect(regions.map((r) => r.label)).toEqual(["Age 0", "Age 1", "Age 2"]);
    expect(regions[0].start).toEqual(new Date(2000, 0, 1));
    expect(regions[0].end).toEqual(new Date(2001, 0, 1));
  });

  it("clips the final region's end to `until` instead of overshooting to the next birthday", () => {
    const regions = computeAgeRegions("2000-01-01", new Date(2002, 5, 15));
    expect(regions.map((r) => r.label)).toEqual(["Age 0", "Age 1", "Age 2"]);
    const last = regions[regions.length - 1];
    expect(last.end).toEqual(new Date(2002, 5, 15));
  });

  it("returns no regions when `until` is before birth", () => {
    expect(computeAgeRegions("2020-01-01", new Date(2010, 0, 1))).toEqual([]);
  });

  it("never assigns a color (age bands are ordinal, not categorical)", () => {
    const regions = computeAgeRegions("2000-01-01", new Date(2001, 0, 1));
    expect(regions.every((r) => r.color === undefined)).toBe(true);
  });
});
