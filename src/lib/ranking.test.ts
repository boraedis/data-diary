import { describe, expect, it } from "vitest";
import { computeRankings, type RankWindow } from "@/lib/ranking";

// Covers the rank-movement rules (#211). The definition has several
// plausible readings, so these pin the one chosen: a window's rank is
// compared against the window immediately before it, like for like.

const WEEK: RankWindow[] = [{ id: "week", label: "Week", days: 7 }];

/** `key` appearing on each of the given dates. */
function on(key: string, ...dates: string[]) {
  return dates.map((date) => ({ key, date }));
}

describe("computeRankings", () => {
  it("sorts by all-time total", () => {
    const result = computeRankings(
      [...on("A", "2026-01-01", "2026-01-02"), ...on("B", "2026-01-01")],
      "2026-01-07",
      [],
    );
    expect(result.map((r) => r.key)).toEqual(["A", "B"]);
    expect(result[0].total).toBe(2);
  });

  it("reports upward movement as positive", () => {
    // Previous week: B ahead of A. Current week: A ahead of B.
    const result = computeRankings(
      [
        ...on("B", "2026-01-01", "2026-01-02", "2026-01-03"),
        ...on("A", "2026-01-01"),
        ...on("A", "2026-01-08", "2026-01-09", "2026-01-10"),
        ...on("B", "2026-01-08"),
      ],
      "2026-01-14",
      WEEK,
    );
    const a = result.find((r) => r.key === "A")!;
    const b = result.find((r) => r.key === "B")!;
    expect(a.movements.week.delta).toBe(1);
    expect(b.movements.week.delta).toBe(-1);
  });

  it("marks someone absent from the previous window as new", () => {
    const result = computeRankings(on("A", "2026-01-10"), "2026-01-14", WEEK);
    expect(result[0].movements.week).toEqual({ delta: null, isNew: true });
  });

  it("does not invent a position for someone absent from the current window", () => {
    // Present only in the previous week. They haven't "fallen to last" —
    // they aren't in this week's ranking at all.
    const result = computeRankings(on("A", "2026-01-02"), "2026-01-14", WEEK);
    expect(result[0].movements.week).toEqual({ delta: null, isNew: false });
    expect(result[0].counts.week).toBe(0);
  });

  it("reports no movement when the order is unchanged", () => {
    const result = computeRankings(
      [
        ...on("A", "2026-01-01", "2026-01-02"),
        ...on("B", "2026-01-01"),
        ...on("A", "2026-01-08", "2026-01-09"),
        ...on("B", "2026-01-08"),
      ],
      "2026-01-14",
      WEEK,
    );
    expect(result.find((r) => r.key === "A")!.movements.week.delta).toBe(0);
    expect(result.find((r) => r.key === "B")!.movements.week.delta).toBe(0);
  });

  it("gives tied counts the same rank, so a tiebreak doesn't read as movement", () => {
    // A and B are level in both windows; C is behind. Nobody moved.
    const result = computeRankings(
      [
        ...on("A", "2026-01-01"),
        ...on("B", "2026-01-02"),
        ...on("A", "2026-01-08"),
        ...on("B", "2026-01-09"),
      ],
      "2026-01-14",
      WEEK,
    );
    expect(result.find((r) => r.key === "A")!.movements.week.delta).toBe(0);
    expect(result.find((r) => r.key === "B")!.movements.week.delta).toBe(0);
  });

  it("anchors windows on asOf, not on today", () => {
    // Everything is years old; anchoring on the latest logged day is what
    // keeps the recent windows meaningful instead of empty.
    const result = computeRankings(on("A", "2019-06-01", "2019-06-02"), "2019-06-03", WEEK);
    expect(result[0].counts.week).toBe(2);
  });

  it("handles several windows independently", () => {
    const windows: RankWindow[] = [
      { id: "week", label: "Week", days: 7 },
      { id: "month", label: "Month", days: 31 },
    ];
    const result = computeRankings(on("A", "2026-01-20", "2026-01-01"), "2026-01-21", windows);
    expect(result[0].counts.week).toBe(1);
    expect(result[0].counts.month).toBe(2);
  });
});
