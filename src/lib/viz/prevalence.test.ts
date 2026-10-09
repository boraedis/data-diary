import { describe, expect, it } from "vitest";
import { buildPrevalenceSeries, prevalenceBucket, prevalenceWindowStart } from "@/lib/viz/prevalence";

const TODAY = "2026-03-15"; // a Sunday

describe("prevalenceWindowStart", () => {
  it("counts today as the window's last day", () => {
    expect(prevalenceWindowStart("1w", TODAY)).toBe("2026-03-09");
    expect(prevalenceWindowStart("1m", TODAY)).toBe("2026-02-16");
    expect(prevalenceWindowStart("1y", TODAY)).toBe("2025-03-16");
    expect(prevalenceWindowStart("all", TODAY)).toBeNull();
  });

  it("keeps a month-end window at least a month long", () => {
    // "Feb 31" overflows into March rather than clamping to Feb 28.
    expect(prevalenceWindowStart("1m", "2026-03-31")).toBe("2026-03-04");
  });
});

describe("prevalenceBucket", () => {
  it("follows the window", () => {
    expect(prevalenceBucket("1w")).toBe("day");
    expect(prevalenceBucket("1m")).toBe("day");
    expect(prevalenceBucket("1y")).toBe("week");
    expect(prevalenceBucket("all")).toBe("month");
  });
});

describe("buildPrevalenceSeries", () => {
  it("returns nothing for an item with no entries", () => {
    expect(buildPrevalenceSeries([], "all", "days", TODAY)).toEqual([]);
  });

  it("zero-fills every day of a week window", () => {
    const series = buildPrevalenceSeries(["2026-03-10", "2026-03-10", "2026-03-14", "2026-01-01"], "1w", "days", TODAY);
    expect(series.map((p) => p.start)).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
    // Two rows on the 10th count as one day; January is outside the window.
    expect(series.map((p) => p.value)).toEqual([0, 1, 0, 0, 0, 1, 0]);
  });

  it("runs all-time from the first entry's month to today's, gaps included", () => {
    const series = buildPrevalenceSeries(["2025-12-20", "2025-12-21", "2026-03-01"], "all", "days", TODAY);
    expect(series).toEqual([
      { start: "2025-12-01", value: 2 },
      { start: "2026-01-01", value: 0 },
      { start: "2026-02-01", value: 0 },
      { start: "2026-03-01", value: 1 },
    ]);
  });

  it("buckets a year window by ISO week", () => {
    const series = buildPrevalenceSeries(["2026-03-10", "2026-03-12"], "1y", "days", TODAY);
    expect(series.at(-1)).toEqual({ start: "2026-03-09", value: 2 });
    expect(series[0].start <= "2025-03-16").toBe(true);
  });

  it("sums minutes rather than counting days", () => {
    const sessions = [
      { date: "2026-03-10", durationMinutes: 30 },
      { date: "2026-03-10", durationMinutes: 45 },
      { date: "2026-03-12", durationMinutes: null },
    ];
    const series = buildPrevalenceSeries(sessions, "1w", "minutes", TODAY);
    expect(series.find((p) => p.start === "2026-03-10")?.value).toBe(75);
    expect(series.find((p) => p.start === "2026-03-12")?.value).toBe(0);
  });

  it("draws a zero line for a window the item has history outside of", () => {
    const series = buildPrevalenceSeries(["2020-01-01"], "1w", "days", TODAY);
    expect(series).toHaveLength(7);
    expect(series.every((p) => p.value === 0)).toBe(true);
  });
});

describe("buildPrevalenceSeries with undated rows", () => {
  it("skips them, and treats an all-undated history as empty", () => {
    expect(buildPrevalenceSeries([{ date: null }], "all", "days", TODAY)).toEqual([]);
    const series = buildPrevalenceSeries([{ date: null }, { date: "2026-03-14" }], "1w", "days", TODAY);
    expect(series.reduce((sum, p) => sum + p.value, 0)).toBe(1);
  });
});
