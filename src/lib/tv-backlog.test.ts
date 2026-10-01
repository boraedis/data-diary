import { describe, expect, it } from "vitest";
import { buildBacklogSeries } from "@/lib/tv-backlog";

describe("buildBacklogSeries", () => {
  it("is empty without events", () => {
    expect(buildBacklogSeries([], "2024-01-10")).toEqual([]);
  });

  it("runs a cumulative sum, filling quiet days", () => {
    const s = buildBacklogSeries(
      [
        { date: "2024-01-01", delta: 3 },
        { date: "2024-01-03", delta: -1 },
      ],
      "2024-01-04",
    );
    expect(s.map((d) => d.backlog)).toEqual([3, 3, 2, 2]);
    expect(s[0].date).toBe("2024-01-01");
  });

  it("ignores events after the cut-off (episodes yet to air)", () => {
    const s = buildBacklogSeries([{ date: "2024-01-01", delta: 1 }, { date: "2024-02-01", delta: 5 }], "2024-01-02");
    expect(s.map((d) => d.backlog)).toEqual([1, 1]);
  });
});
