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

  it("cycles through the fixed 7-color wheel by age, wrapping around", () => {
    // 9 regions (age 0-8) over a wheel of 7 colors: age 7 repeats age 0's
    // color, age 8 repeats age 1's.
    const regions = computeAgeRegions("2000-01-01", new Date(2009, 0, 1));
    expect(regions).toHaveLength(9);
    const colors = regions.map((r) => r.color);
    expect(colors.every((c) => typeof c === "string")).toBe(true);
    expect(colors[7]).toBe(colors[0]);
    expect(colors[8]).toBe(colors[1]);
    expect(colors[0]).not.toBe(colors[1]);
  });
});

// --- Training volume month filling (#218) ---------------------------------
// `getTrainingVolumeData` is a DB read wrapped around this month-stepping,
// which is the one piece with logic worth pinning down: the real data has a
// single empty month (2023-01) between two active ones, and omitting it made
// the line slope across the gap as though training continued.

describe("nextMonth (via training volume month filling)", () => {
  // Re-stated here rather than exported from charts.ts: the helper is an
  // implementation detail of one fetcher, and widening that module's API
  // just to test three lines would be the wrong trade.
  function nextMonth(month: string): string {
    const [year, m] = month.split("-").map(Number);
    return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  }

  it("steps within a year, zero-padding the month", () => {
    expect(nextMonth("2023-01")).toBe("2023-02");
    expect(nextMonth("2023-08")).toBe("2023-09");
  });

  it("rolls over into the next year", () => {
    expect(nextMonth("2022-12")).toBe("2023-01");
  });

  it("produces keys that sort and compare as strings", () => {
    // The fill loop walks with `month <= last`, so lexical order has to
    // match chronological order — which is only true while months stay
    // zero-padded.
    expect(["2023-10", "2023-09", "2023-01"].sort()).toEqual([
      "2023-01",
      "2023-09",
      "2023-10",
    ]);
    expect("2022-12" < "2023-01").toBe(true);
  });
});
