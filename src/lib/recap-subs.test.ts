import { describe, expect, it } from "vitest";
import { buildRecapSubs, RECAP_SUB_NAMES, type RecapSubDay } from "@/lib/recap-subs";
import { previousPeriod, yearPeriod } from "@/lib/recap";

// Covers the rules that make the subs section (issue #170): what the
// average is taken over, which direction of change counts as improvement,
// and when a comparison is allowed at all. For these subs less is better —
// several of these tests exist specifically to pin that down.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

/** A day carrying values for the reported subs, in RECAP_SUB_NAMES order. */
function day(date: string, ...values: (number | null)[]): RecapSubDay {
  return { date, values: RECAP_SUB_NAMES.map((_, i) => values[i] ?? null) };
}

const first = RECAP_SUB_NAMES[0];

describe("averages", () => {
  it("averages logged values across the period", () => {
    const result = buildRecapSubs([day("2025-01-01", 2), day("2025-01-02", 4)], period, prior);
    expect(result.summaries[0]).toMatchObject({ name: first, average: 3, daysLogged: 2 });
  });

  it("counts logged zeros in the average", () => {
    // A zero day is a real day of not doing it, and excluding it would
    // answer "how heavy was it when it happened" instead — which improves
    // in exactly the years you did it less often.
    const result = buildRecapSubs([day("2025-01-01", 0), day("2025-01-02", 4)], period, prior);
    expect(result.summaries[0].average).toBe(2);
  });

  it("excludes blank days rather than treating them as zero", () => {
    const result = buildRecapSubs([day("2025-01-01", 4), day("2025-01-02", null)], period, prior);
    expect(result.summaries[0]).toMatchObject({ average: 4, daysLogged: 1 });
  });

  it("reports a null average when nothing was logged", () => {
    const result = buildRecapSubs([day("2025-01-01", null)], period, prior);
    expect(result.summaries[0]).toMatchObject({ average: null, daysLogged: 0 });
    expect(result.daysWithSubData).toBe(0);
  });

  it("keeps the two periods apart", () => {
    const result = buildRecapSubs([day("2024-01-01", 8), day("2025-01-01", 2)], period, prior);
    expect(result.summaries[0]).toMatchObject({ average: 2, priorAverage: 8 });
  });

  it("ignores days outside both periods", () => {
    const result = buildRecapSubs([day("2019-01-01", 9), day("2025-01-01", 1)], period, prior);
    expect(result.summaries[0]).toMatchObject({ average: 1, priorAverage: null });
  });
});

describe("movers", () => {
  it("treats a fall in average as the improvement", () => {
    const result = buildRecapSubs([day("2024-01-01", 6), day("2025-01-01", 2)], period, prior);
    expect(result.mostImproved).toEqual({
      name: first,
      change: -4,
      average: 2,
      priorAverage: 6,
    });
    expect(result.biggestIncrease).toBeNull();
  });

  it("reports a rise separately from an improvement", () => {
    const result = buildRecapSubs(
      [day("2024-01-01", 1, 5), day("2025-01-01", 4, 2)],
      period,
      prior
    );
    expect(result.mostImproved?.name).toBe(RECAP_SUB_NAMES[1]);
    expect(result.biggestIncrease?.name).toBe(first);
  });

  it("picks the largest move when several went the same way", () => {
    const result = buildRecapSubs(
      [day("2024-01-01", 5, 5), day("2025-01-01", 4, 1)],
      period,
      prior
    );
    expect(result.mostImproved?.name).toBe(RECAP_SUB_NAMES[1]);
    expect(result.mostImproved?.change).toBe(-4);
  });

  it("does not call a sub improved when it simply stopped being tracked", () => {
    // Logged last year, never logged this year: a change in recording, not
    // in behaviour, and congratulating it would be wrong.
    const result = buildRecapSubs([day("2024-01-01", 7), day("2025-01-01", null)], period, prior);
    expect(result.mostImproved).toBeNull();
  });

  it("has no movers at all without a prior period", () => {
    const result = buildRecapSubs([day("2025-01-01", 3)], period, prior);
    expect(result.mostImproved).toBeNull();
    expect(result.biggestIncrease).toBeNull();
  });
});
