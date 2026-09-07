import { describe, expect, it } from "vitest";
import { computeRankings, type RankWindow } from "@/lib/ranking";

// Covers the point-in-time rank rules (#211). The definition has several
// plausible readings, so these pin the chosen one: a window's rank is the
// all-time standing *as it was at that moment*, compared with now — not the
// window's own activity compared with the window before it.

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

  it("compares against the standing at that point in time", () => {
    // A week ago B led 3-1 on cumulative totals. Since then A has added
    // three days and overtaken, so A is up one place and B down one.
    const result = computeRankings(
      [
        ...on("B", "2026-01-01", "2026-01-02", "2026-01-03"),
        ...on("A", "2026-01-01"),
        ...on("A", "2026-01-12", "2026-01-13", "2026-01-14"),
      ],
      "2026-01-14",
      WEEK,
    );
    expect(result.find((r) => r.key === "A")!.movements.week.delta).toBe(1);
    expect(result.find((r) => r.key === "B")!.movements.week.delta).toBe(-1);
  });

  it("does not report movement for activity that changed no standing", () => {
    // Both were active this week, but their relative order never changed —
    // the thing a window-versus-window definition would have reported as
    // churn.
    const result = computeRankings(
      [
        ...on("A", "2026-01-01", "2026-01-02", "2026-01-03"),
        ...on("B", "2026-01-01"),
        ...on("A", "2026-01-12"),
        ...on("B", "2026-01-13"),
      ],
      "2026-01-14",
      WEEK,
    );
    expect(result.find((r) => r.key === "A")!.movements.week.delta).toBe(0);
    expect(result.find((r) => r.key === "B")!.movements.week.delta).toBe(0);
  });

  it("marks someone who did not yet exist in the ranking as new", () => {
    const result = computeRankings(on("A", "2026-01-10"), "2026-01-14", WEEK);
    expect(result[0].movements.week).toEqual({ delta: null, isNew: true });
  });

  it("reports no movement for someone inactive this week but long established", () => {
    // Absent lately, but their standing is unchanged — nobody passed them.
    const result = computeRankings(on("A", "2026-01-01", "2026-01-02"), "2026-01-14", WEEK);
    expect(result[0].movements.week).toEqual({ delta: 0, isNew: false });
    expect(result[0].counts.week).toBe(0);
  });

  it("counts appearances gained inside the window", () => {
    const result = computeRankings(
      on("A", "2026-01-01", "2026-01-12", "2026-01-13"),
      "2026-01-14",
      WEEK,
    );
    expect(result[0].total).toBe(3);
    expect(result[0].counts.week).toBe(2);
  });

  it("gives tied counts the same rank, so a tiebreak doesn't read as movement", () => {
    const result = computeRankings(
      [
        ...on("A", "2026-01-01"),
        ...on("B", "2026-01-02"),
        ...on("A", "2026-01-12"),
        ...on("B", "2026-01-13"),
      ],
      "2026-01-14",
      WEEK,
    );
    expect(result.find((r) => r.key === "A")!.movements.week.delta).toBe(0);
    expect(result.find((r) => r.key === "B")!.movements.week.delta).toBe(0);
  });

  it("anchors windows on asOf, not on today", () => {
    const result = computeRankings(on("A", "2019-06-01", "2019-06-02"), "2019-06-03", WEEK);
    expect(result[0].counts.week).toBe(2);
    expect(result[0].movements.week.isNew).toBe(true);
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
