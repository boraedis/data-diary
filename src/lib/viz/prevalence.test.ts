import { describe, expect, it } from "vitest";
import { buildPrevalenceSeries } from "@/lib/viz/prevalence";

const TODAY = "2026-03-15"; // a Sunday

describe("buildPrevalenceSeries", () => {
  it("returns nothing for an item with no entries", () => {
    expect(buildPrevalenceSeries([], "month", "days", TODAY)).toEqual([]);
  });

  it("runs from the first entry's month to today's, gaps included", () => {
    const series = buildPrevalenceSeries(["2025-12-20", "2025-12-21", "2026-03-01"], "month", "days", TODAY);
    expect(series).toEqual([
      { start: "2025-12-01", value: 2 },
      { start: "2026-01-01", value: 0 },
      { start: "2026-02-01", value: 0 },
      { start: "2026-03-01", value: 1 },
    ]);
  });

  it("counts distinct days, not rows", () => {
    const series = buildPrevalenceSeries(["2026-03-10", "2026-03-10", "2026-03-12"], "week", "days", TODAY);
    expect(series).toEqual([{ start: "2026-03-09", value: 2 }]);
  });

  it("buckets by ISO week and by year", () => {
    const weeks = buildPrevalenceSeries(["2026-02-27", "2026-03-14"], "week", "days", TODAY);
    expect(weeks.map((p) => p.start)).toEqual(["2026-02-23", "2026-03-02", "2026-03-09"]);
    expect(weeks.map((p) => p.value)).toEqual([1, 0, 1]);

    const years = buildPrevalenceSeries(["2023-06-01", "2023-07-01", "2026-01-05"], "year", "days", TODAY);
    expect(years).toEqual([
      { start: "2023-01-01", value: 2 },
      { start: "2024-01-01", value: 0 },
      { start: "2025-01-01", value: 0 },
      { start: "2026-01-01", value: 1 },
    ]);
  });

  it("sums minutes rather than counting days", () => {
    const sessions = [
      { date: "2026-03-10", durationMinutes: 30 },
      { date: "2026-03-10", durationMinutes: 45 },
      { date: "2026-03-12", durationMinutes: null },
    ];
    expect(buildPrevalenceSeries(sessions, "month", "minutes", TODAY)).toEqual([{ start: "2026-03-01", value: 75 }]);
  });

  it("skips undated rows, and treats an all-undated history as empty", () => {
    expect(buildPrevalenceSeries([{ date: null }], "month", "days", TODAY)).toEqual([]);
    const series = buildPrevalenceSeries([{ date: null }, { date: "2026-03-14" }], "month", "days", TODAY);
    expect(series).toEqual([{ start: "2026-03-01", value: 1 }]);
  });

  it("leaves out entries dated after today", () => {
    const series = buildPrevalenceSeries(["2026-03-01", "2026-05-01"], "month", "days", TODAY);
    expect(series).toEqual([{ start: "2026-03-01", value: 1 }]);
  });
});
