import { describe, expect, it } from "vitest";
import { buildRecapSubs, longestCleanStreak, type RecapSubDay } from "@/lib/recap-subs";
import { previousPeriod, yearPeriod } from "@/lib/recap";
import { SUB_NAMES } from "@/lib/days";

// Covers the rules that make the subs section (issue #170): what counts as
// a clean day, what breaks a streak, and which direction of change counts
// as improvement. For these nine, less is better — several of these tests
// exist specifically to pin that down.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

/** A day with every sub at `fill`, optionally overriding some by index. */
function day(date: string, fill: number | null, overrides: Record<number, number | null> = {}): RecapSubDay {
  const values = SUB_NAMES.map(() => fill);
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return { date, values };
}

describe("clean days", () => {
  it("counts a day where every sub is logged at zero", () => {
    const result = buildRecapSubs([day("2025-04-01", 0)], period, prior);
    expect(result.cleanDays.total).toBe(1);
  });

  it("does not count a day with any sub above zero", () => {
    const result = buildRecapSubs([day("2025-04-01", 0, { 0: 2 })], period, prior);
    expect(result.cleanDays.total).toBe(0);
  });

  it("does not treat a partially-filled day as clean", () => {
    // Three zeros and six blanks is a half-filled form, not evidence of a
    // clean day — counting it would inflate both this and the streak.
    const result = buildRecapSubs([day("2025-04-01", null, { 0: 0, 1: 0, 2: 0 })], period, prior);
    expect(result.cleanDays.total).toBe(0);
    expect(result.daysWithSubData).toBe(1);
  });
});

describe("longestCleanStreak", () => {
  it("counts consecutive clean days", () => {
    const streak = longestCleanStreak(
      [day("2025-01-01", 0), day("2025-01-02", 0), day("2025-01-03", 0)],
      period
    );
    expect(streak).toEqual({ length: 3, start: "2025-01-01", end: "2025-01-03" });
  });

  it("breaks on an unlogged day rather than skipping over it", () => {
    // 01-02 has no row at all. Skipping gaps would report 4 here, and would
    // hand the longest streaks to the worst-logged years.
    const streak = longestCleanStreak(
      [day("2025-01-01", 0), day("2025-01-03", 0), day("2025-01-04", 0)],
      period
    );
    expect(streak.length).toBe(2);
    expect(streak.start).toBe("2025-01-03");
  });

  it("breaks on a day that isn't clean", () => {
    const streak = longestCleanStreak(
      [day("2025-01-01", 0), day("2025-01-02", 0, { 3: 1 }), day("2025-01-03", 0)],
      period
    );
    expect(streak.length).toBe(1);
  });

  it("reports zero when no day is clean", () => {
    const streak = longestCleanStreak([day("2025-01-01", 0, { 0: 5 })], period);
    expect(streak).toEqual({ length: 0, start: null, end: null });
  });

  it("ignores clean days outside the period", () => {
    const streak = longestCleanStreak([day("2024-12-31", 0)], period);
    expect(streak.length).toBe(0);
  });
});

describe("movers", () => {
  it("treats a drop in days as the improvement, and names it", () => {
    const result = buildRecapSubs(
      [
        day("2024-02-01", 0, { 0: 3 }),
        day("2024-02-02", 0, { 0: 3 }),
        day("2025-02-01", 0, { 0: 3 }),
      ],
      period,
      prior
    );
    expect(result.mostImproved).toEqual({
      name: "A",
      change: -1,
      daysWithAny: 1,
      priorDaysWithAny: 2,
    });
    expect(result.biggestIncrease).toBeNull();
  });

  it("reports a rise separately from an improvement", () => {
    const result = buildRecapSubs(
      [
        day("2024-02-01", 0, { 0: 2 }),
        day("2025-02-01", 0, { 0: 2 }),
        day("2025-02-02", 0, { 1: 4 }),
        day("2025-02-03", 0, { 1: 4 }),
      ],
      period,
      prior
    );
    expect(result.mostImproved).toBeNull();
    expect(result.biggestIncrease?.name).toBe("W");
    expect(result.biggestIncrease?.change).toBe(2);
  });

  it("does not call a sub 'most improved' when it simply stopped being tracked", () => {
    // Logged 2 days last year, never logged this year. That's a change in
    // recording, not in behaviour, and congratulating it would be wrong.
    const result = buildRecapSubs(
      [
        { date: "2024-03-01", values: SUB_NAMES.map((_, i) => (i === 0 ? 5 : null)) },
        { date: "2024-03-02", values: SUB_NAMES.map((_, i) => (i === 0 ? 5 : null)) },
        { date: "2025-03-01", values: SUB_NAMES.map(() => null) },
      ],
      period,
      prior
    );
    expect(result.mostImproved).toBeNull();
  });
});

describe("coverage", () => {
  it("reports no sub data for a period that has none, rather than nine zeros", () => {
    const result = buildRecapSubs([day("2025-05-01", null)], period, prior);
    expect(result.daysWithSubData).toBe(0);
    expect(result.summaries.every((s) => s.daysLogged === 0)).toBe(true);
  });

  it("counts days with any above zero per sub", () => {
    const result = buildRecapSubs(
      [day("2025-06-01", 0, { 0: 1 }), day("2025-06-02", 0, { 0: 0 })],
      period,
      prior
    );
    const a = result.summaries.find((s) => s.name === "A");
    expect(a).toMatchObject({ daysWithAny: 1, daysLogged: 2 });
  });
});
