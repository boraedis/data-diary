import { describe, expect, it } from "vitest";
import {
  GOOD_DAY_THRESHOLD,
  longestGoodStreak,
  summarizeExercise,
  summarizeHappiness,
  summarizeSleep,
  SLEEP_LOCATION_SLOTS,
  type RecapSleepNight,
} from "@/lib/recap-health";
import { MIN_DAYS_FOR_AVERAGE } from "@/lib/recap";
import { previousPeriod, yearPeriod } from "@/lib/recap";

// Covers the folds behind the health & wellness section (issue #201): the
// period split, high/low selection and its tie-breaking, and the
// days-trained-vs-rows distinction that the exercise card depends on.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

describe("summarizeHappiness", () => {
  it("averages each period separately", () => {
    const result = summarizeHappiness(
      [
        { date: "2024-06-01", happiness: 40 },
        { date: "2025-06-01", happiness: 60 },
        { date: "2025-06-02", happiness: 80 },
      ],
      period,
      prior
    );
    expect(result).toMatchObject({ average: 70, priorAverage: 40, daysLogged: 2, priorDaysLogged: 1 });
  });

  it("picks the highest and lowest day of the period, with dates", () => {
    const result = summarizeHappiness(
      [
        { date: "2025-02-01", happiness: 55 },
        { date: "2025-03-12", happiness: 94 },
        { date: "2025-09-04", happiness: 12 },
      ],
      period,
      prior
    );
    expect(result.best).toEqual({ date: "2025-03-12", happiness: 94 });
    expect(result.worst).toEqual({ date: "2025-09-04", happiness: 12 });
  });

  it("breaks ties toward the earlier day", () => {
    // Stability matters more than which day wins: the card must not change
    // its answer between requests.
    const result = summarizeHappiness(
      [
        { date: "2025-01-05", happiness: 90 },
        { date: "2025-11-20", happiness: 90 },
      ],
      period,
      prior
    );
    expect(result.best?.date).toBe("2025-01-05");
  });

  it("never picks a best or worst day from outside the period", () => {
    const result = summarizeHappiness(
      [
        { date: "2024-01-01", happiness: 100 },
        { date: "2025-05-05", happiness: 30 },
      ],
      period,
      prior
    );
    expect(result.best).toEqual({ date: "2025-05-05", happiness: 30 });
    expect(result.priorAverage).toBe(100);
  });

  it("reports nothing rather than zero when the period has no scores", () => {
    const result = summarizeHappiness([{ date: "2024-01-01", happiness: 50 }], period, prior);
    expect(result).toMatchObject({ average: null, daysLogged: 0, best: null, worst: null });
  });
});

describe("summarizeSleep", () => {
  it("averages nightly duration and finds the extremes", () => {
    const result = summarizeSleep(
      [
        { date: "2025-01-01", durationMinutes: 400 },
        { date: "2025-01-02", durationMinutes: 500 },
        { date: "2024-01-01", durationMinutes: 300 },
      ],
      period,
      prior
    );
    expect(result).toMatchObject({
      averageMinutes: 450,
      priorAverageMinutes: 300,
      nightsLogged: 2,
      priorNightsLogged: 1,
    });
    expect(result.longest?.date).toBe("2025-01-02");
    expect(result.shortest?.date).toBe("2025-01-01");
  });

  it("has no extremes when the period has no logged nights", () => {
    const result = summarizeSleep([], period, prior);
    expect(result).toMatchObject({ averageMinutes: null, longest: null, shortest: null });
  });
});

describe("summarizeExercise", () => {
  it("counts days trained, not workout rows", () => {
    // One session of eight exercises is eight rows and one day. "412
    // workouts" is the number that flatters; "days trained" is the claim.
    const result = summarizeExercise(
      [
        { date: "2025-04-01" },
        { date: "2025-04-01" },
        { date: "2025-04-01" },
        { date: "2025-04-02" },
      ],
      period,
      prior
    );
    expect(result.daysTrained).toBe(2);
    expect(result.exercisesLogged).toBe(4);
  });

  it("counts the prior period's days separately", () => {
    const result = summarizeExercise(
      [{ date: "2024-04-01" }, { date: "2024-04-02" }, { date: "2025-04-01" }],
      period,
      prior
    );
    expect(result).toMatchObject({ daysTrained: 1, priorDaysTrained: 2 });
  });

  it("reports zero for a period with no workouts", () => {
    const result = summarizeExercise([{ date: "2019-01-01" }], period, prior);
    expect(result).toMatchObject({ daysTrained: 0, priorDaysTrained: 0, exercisesLogged: 0 });
  });
});

describe("longestGoodStreak", () => {
  const good = (date: string) => ({ date, happiness: GOOD_DAY_THRESHOLD });

  it("finds the longest run of consecutive good days", () => {
    const result = longestGoodStreak(
      [
        good("2025-03-01"),
        good("2025-03-02"),
        { date: "2025-03-03", happiness: GOOD_DAY_THRESHOLD - 1 },
        good("2025-03-04"),
        good("2025-03-05"),
        good("2025-03-06"),
      ],
      period
    );
    expect(result).toEqual({ length: 3, start: "2025-03-04", end: "2025-03-06" });
  });

  it("breaks a run on an unlogged day", () => {
    const result = longestGoodStreak(
      [good("2025-03-01"), good("2025-03-02"), good("2025-03-04"), good("2025-03-05")],
      period
    );
    expect(result).toEqual({ length: 2, start: "2025-03-01", end: "2025-03-02" });
  });

  it("breaks ties toward the earlier run", () => {
    const result = longestGoodStreak(
      [good("2025-03-01"), good("2025-03-02"), good("2025-05-01"), good("2025-05-02")],
      period
    );
    expect(result?.start).toBe("2025-03-01");
  });

  it("ignores days outside the period, including across its edge", () => {
    const result = longestGoodStreak(
      [good("2024-12-30"), good("2024-12-31"), good("2025-01-01")],
      period
    );
    expect(result).toEqual({ length: 1, start: "2025-01-01", end: "2025-01-01" });
  });

  it("is null when no day reached the bar", () => {
    expect(longestGoodStreak([{ date: "2025-03-01", happiness: 10 }], period)).toBeNull();
    expect(longestGoodStreak([], period)).toBeNull();
  });

  it("is carried on the happiness summary for both periods, with the scored series", () => {
    const result = summarizeHappiness(
      [good("2024-06-01"), good("2024-06-02"), good("2025-06-01")],
      period,
      prior
    );
    expect(result.priorStreak?.length).toBe(2);
    expect(result.streak?.length).toBe(1);
    expect(result.series).toEqual([good("2025-06-01")]);
  });
});

// #531: where the nights were slept, and naps.
describe("summarizeSleep locations and naps", () => {
  const night = (date: string, durationMinutes: number, locationType: string | null = null, napMinutes: number | null = null): RecapSleepNight => ({
    date,
    durationMinutes,
    locationType,
    napMinutes,
  });

  it("attributes each night to the period holding its row date", () => {
    const result = summarizeSleep(
      [night("2024-12-31", 300, "Home"), night("2025-01-01", 480, "Home"), night("2025-12-31", 420, "Hotel")],
      period,
      prior
    );
    expect(result.locations.rows).toEqual([
      { label: "Home", other: false, colorIndex: 0, nights: 1, averageMinutes: 480, priorNights: 1, priorAverageMinutes: 300 },
      { label: "Hotel", other: false, colorIndex: 1, nights: 1, averageMinutes: 420, priorNights: 0, priorAverageMinutes: null },
    ]);
    expect(result.locations).toMatchObject({ locatedNights: 2, priorLocatedNights: 1 });
  });

  it("counts an unrecorded location for coverage only, never as a row", () => {
    const result = summarizeSleep(
      [night("2025-03-01", 400, null), night("2025-03-02", 420, null), night("2025-03-03", 440, "Home")],
      period,
      prior
    );
    expect(result.nightsLogged).toBe(3);
    expect(result.locations.locatedNights).toBe(1);
    expect(result.locations.rows.map((r) => r.label)).toEqual(["Home"]);
    // A plain SleepDay, with neither field, reads the same as null.
    expect(summarizeSleep([{ date: "2025-03-01", durationMinutes: 400 }], period, prior).locations.locatedNights).toBe(0);
  });

  it("keeps naps apart from nights", () => {
    const result = summarizeSleep(
      [night("2025-05-01", 420, "Home", 30), night("2025-05-02", 400, "Home", 0), night("2024-05-01", 410, null, 45)],
      period,
      prior
    );
    expect(result.naps).toEqual({ totalMinutes: 30, daysWithNap: 1, priorTotalMinutes: 45, priorDaysWithNap: 1 });
    // The nap adds to neither the night count nor the nights' durations.
    expect(result.nightsLogged).toBe(2);
    expect(result.averageMinutes).toBe(410);
    expect(result.locations.rows[0].averageMinutes).toBe(410);
  });

  it("folds locations past the colour slots into one Other row with its own average", () => {
    const places = ["A", "B", "C", "D", "E", "F", "G"];
    // A gets 7 nights, B 6, ... G 1, so the ranking is alphabetical.
    const nights = places.flatMap((p, i) =>
      Array.from({ length: places.length - i }, (_, k) => night(`2025-0${i + 1}-${String(k + 1).padStart(2, "0")}`, p === "F" ? 300 : 600, p))
    );
    const rows = summarizeSleep(nights, period, prior).locations.rows;
    expect(rows.map((r) => r.label)).toEqual(["A", "B", "C", "D", "E", "Other"]);
    const other = rows[rows.length - 1];
    // F's two nights at 300 and G's one at 600, averaged over all three.
    expect(other).toMatchObject({ other: true, colorIndex: SLEEP_LOCATION_SLOTS, nights: 3, averageMinutes: 400 });
  });

  it("doesn't fold a lone extra location into Other", () => {
    const nights = ["A", "B", "C", "D", "E", "F"].map((p, i) => night(`2025-02-0${i + 1}`, 400, p));
    expect(summarizeSleep(nights, period, prior).locations.rows.some((r) => r.other)).toBe(false);
  });

  it("reports located-night coverage against the breakdown's threshold", () => {
    const located = (n: number) =>
      Array.from({ length: n }, (_, i) => night(`2025-04-${String(i + 1).padStart(2, "0")}`, 420, "Home"));
    // The report and the story both gate the breakdown on this count.
    expect(summarizeSleep(located(MIN_DAYS_FOR_AVERAGE - 1), period, prior).locations.locatedNights).toBeLessThan(MIN_DAYS_FOR_AVERAGE);
    expect(summarizeSleep(located(MIN_DAYS_FOR_AVERAGE), period, prior).locations.locatedNights).toBe(MIN_DAYS_FOR_AVERAGE);
  });
});
