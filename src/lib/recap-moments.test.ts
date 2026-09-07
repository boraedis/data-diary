import { describe, expect, it } from "vitest";
import { happinessMoments, type HappinessScore } from "@/lib/recap-moments";
import { yearPeriod } from "@/lib/recap";

// Covers the happiness signal (issue #174) — the percentile rule, the
// all-time baseline, and the collapsing of adjacent days. The first-time
// signals are `firstSeenInPeriodWithDates` over different tables and are
// covered by the foundation's own tests.

const period = yearPeriod(2025);

/** `count` filler days at `score`, starting well before the period so they
 * only ever act as baseline. */
function baseline(count: number, score = 80): HappinessScore[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
    happiness: score,
  }));
}

describe("happinessMoments", () => {
  it("emits nothing until there is enough history for percentiles to mean anything", () => {
    // 99 all-time scores, one of them extraordinary — still no moment,
    // because a 99th percentile over 99 days is just "the best of 99 days".
    const scores = [...baseline(98), { date: "2025-06-01", happiness: 100 }];
    expect(happinessMoments(scores, period)).toEqual([]);
  });

  it("emits a spike for a day at the top of the all-time distribution", () => {
    const scores = [...baseline(150), { date: "2025-06-01", happiness: 100 }];
    const moments = happinessMoments(scores, period);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      date: "2025-06-01",
      kind: "happiness-spike",
      detail: "100 / 100",
    });
  });

  it("emits a dip for a day at the bottom", () => {
    const scores = [...baseline(150), { date: "2025-06-01", happiness: 5 }];
    const moments = happinessMoments(scores, period);
    expect(moments[0]).toMatchObject({ kind: "happiness-dip", date: "2025-06-01" });
  });

  it("measures against all-time, so a weak year does not promote its own average days", () => {
    // The period's own best day is 60, well below the all-time norm of 80.
    // Scored against itself it would be a "spike"; against all time it is
    // nothing of the sort.
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 60 },
      { date: "2025-06-02", happiness: 58 },
    ];
    expect(happinessMoments(scores, period).some((m) => m.kind === "happiness-spike")).toBe(false);
  });

  it("collapses a run of adjacent qualifying days into its peak", () => {
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 99 },
      { date: "2025-06-02", happiness: 100 },
      { date: "2025-06-03", happiness: 99 },
    ];
    const moments = happinessMoments(scores, period);
    expect(moments).toHaveLength(1);
    expect(moments[0].date).toBe("2025-06-02");
  });

  it("keeps non-adjacent qualifying days as separate moments", () => {
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 100 },
      { date: "2025-09-01", happiness: 100 },
    ];
    expect(happinessMoments(scores, period)).toHaveLength(2);
  });

  it("does not merge a dip into an adjacent spike", () => {
    // The contrast is arguably the more interesting thing that happened.
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 100 },
      { date: "2025-06-02", happiness: 5 },
    ];
    const moments = happinessMoments(scores, period);
    expect(moments.map((m) => m.kind)).toEqual(["happiness-spike", "happiness-dip"]);
  });

  it("ignores qualifying days outside the period", () => {
    const scores = [...baseline(150), { date: "2024-06-01", happiness: 100 }];
    expect(happinessMoments(scores, period)).toEqual([]);
  });

  it("scores the most extreme day at full magnitude", () => {
    const scores = [...baseline(150), { date: "2025-06-01", happiness: 100 }];
    expect(happinessMoments(scores, period)[0].magnitude).toBeCloseTo(1);
  });
});
