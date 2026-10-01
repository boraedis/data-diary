import { describe, expect, it } from "vitest";
import { buildBacklogSeries, type BacklogEvent } from "@/lib/tv-backlog";

const ev = (date: string, showId: string, delta: number): BacklogEvent => ({ date, showId, title: `Show ${showId}`, delta });

describe("buildBacklogSeries", () => {
  it("is empty without events", () => {
    expect(buildBacklogSeries([], "2024-01-10")).toEqual({ bands: [], days: [] });
  });

  it("runs a per-show cumulative sum, filling quiet days", () => {
    const { days } = buildBacklogSeries([ev("2024-01-01", "a", 3), ev("2024-01-03", "a", -1)], "2024-01-04");
    expect(days.map((d) => d.values.a)).toEqual([3, 3, 2, 2]);
    expect(days[0].date).toBe("2024-01-01");
  });

  it("omits a show once it's caught up, rather than carrying a zero", () => {
    const { days } = buildBacklogSeries([ev("2024-01-01", "a", 1), ev("2024-01-02", "a", -1)], "2024-01-03");
    expect(days.map((d) => "a" in d.values)).toEqual([true, false, false]);
  });

  it("keeps shows separate and orders bands by total backlog, biggest first", () => {
    const { bands, days } = buildBacklogSeries([ev("2024-01-01", "a", 1), ev("2024-01-01", "b", 4)], "2024-01-02");
    expect(bands.map((b) => b.id)).toEqual(["b", "a"]);
    expect(days[1].values).toEqual({ a: 1, b: 4 });
  });

  it("ignores events after the cut-off (episodes yet to air)", () => {
    const { days } = buildBacklogSeries([ev("2024-01-01", "a", 1), ev("2024-02-01", "a", 5)], "2024-01-02");
    expect(days.map((d) => d.values.a)).toEqual([1, 1]);
  });
});
