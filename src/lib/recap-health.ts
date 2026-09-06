import { and, asc, gte, isNotNull, lte } from "drizzle-orm";
import { days, workouts } from "@/db/schema";
import { getSleepCalendarData, type SleepDay } from "@/lib/charts";
import { getDb } from "@/lib/db";
import type { RecapPeriod } from "@/lib/recap";

// The recap's health & wellness section (issue #201, epic #130).
//
// Happiness, sleep and exercise together — the same question asked three
// ways. Split out of #170 when that became the subs section, which is why
// this arrives after the other domains.
//
// Unlike the subs, nothing here has a single "good" direction worth
// asserting. More sleep is usually better and more training usually is
// too, but neither is true enough at the edges to build copy around, so
// these cards keep the neutral phrasing every other section uses. The subs
// section is the deliberate exception, not the pattern.

/** A day's happiness score (0-100, `days.happiness`). */
export type HappinessDay = { date: string; happiness: number };

export type RecapHappiness = {
  average: number | null;
  priorAverage: number | null;
  daysLogged: number;
  priorDaysLogged: number;
  /** Highest and lowest scoring day in the period. Date and score only —
   * #130 excludes freeform text from every card, so `happinessReason` is
   * deliberately not read here even though it sits in the same row. */
  best: HappinessDay | null;
  worst: HappinessDay | null;
};

export type RecapSleep = {
  averageMinutes: number | null;
  priorAverageMinutes: number | null;
  nightsLogged: number;
  priorNightsLogged: number;
  longest: SleepDay | null;
  shortest: SleepDay | null;
};

export type RecapExercise = {
  /** Days with at least one workout logged — see the note on the fetcher
   * for why this, and not the row count. */
  daysTrained: number;
  priorDaysTrained: number;
  /** Individual exercises performed. Shown as supporting detail, never as
   * the headline, because it's the number that flatters. */
  exercisesLogged: number;
};

export type RecapHealth = {
  happiness: RecapHappiness;
  sleep: RecapSleep;
  exercise: RecapExercise;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function inPeriod(date: string, period: RecapPeriod): boolean {
  return date >= period.start && date <= period.end;
}

/** Happiness for both periods, plus the period's high and low day. */
async function getHappiness(period: RecapPeriod, prior: RecapPeriod): Promise<RecapHappiness> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness })
    .from(days)
    .where(
      and(gte(days.date, prior.start), lte(days.date, period.end), isNotNull(days.happiness))
    )
    .orderBy(asc(days.date));

  return summarizeHappiness(
    rows.map((row) => ({ date: row.date, happiness: row.happiness as number })),
    period,
    prior
  );
}

/**
 * Exported and pure — the period split and the high/low selection are the
 * parts worth pinning down, and neither needs a database.
 *
 * Ties go to the earliest day: the comparisons below are strict, so the
 * first row of a tied pair wins and the caller's ascending order decides.
 * Arbitrary, but stable — the card shouldn't change its mind between
 * requests the way an unordered `Math.max` would.
 */
export function summarizeHappiness(
  scored: HappinessDay[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapHappiness {
  const current = scored.filter((row) => inPeriod(row.date, period));
  const previous = scored.filter((row) => inPeriod(row.date, prior));

  let best: HappinessDay | null = null;
  let worst: HappinessDay | null = null;
  for (const day of current) {
    if (best === null || day.happiness > best.happiness) best = day;
    if (worst === null || day.happiness < worst.happiness) worst = day;
  }

  return {
    average: mean(current.map((d) => d.happiness)),
    priorAverage: mean(previous.map((d) => d.happiness)),
    daysLogged: current.length,
    priorDaysLogged: previous.length,
    best,
    worst,
  };
}

/**
 * Sleep for both periods.
 *
 * Reuses `getSleepCalendarData` rather than re-deriving duration from
 * `sleepTime`/`wakeTime`/`wakeCrossedMidnight`. That derivation carries
 * real subtlety — the across-midnight flag, and a guard that drops
 * impossible durations — and it lives in one place on purpose (#201 says
 * as much). The cost is fetching every logged night and filtering in
 * memory; that's a few thousand rows, the same personal scale the people
 * and places section already fetches whole, and it's the right trade
 * against duplicating a derivation that would then have to be kept
 * correct twice.
 */
async function getSleep(period: RecapPeriod, prior: RecapPeriod): Promise<RecapSleep> {
  return summarizeSleep(await getSleepCalendarData(), period, prior);
}

export function summarizeSleep(
  nights: SleepDay[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapSleep {
  const current = nights.filter((night) => inPeriod(night.date, period));
  const previous = nights.filter((night) => inPeriod(night.date, prior));

  let longest: SleepDay | null = null;
  let shortest: SleepDay | null = null;
  for (const night of current) {
    if (longest === null || night.durationMinutes > longest.durationMinutes) longest = night;
    if (shortest === null || night.durationMinutes < shortest.durationMinutes) shortest = night;
  }

  return {
    averageMinutes: mean(current.map((n) => n.durationMinutes)),
    priorAverageMinutes: mean(previous.map((n) => n.durationMinutes)),
    nightsLogged: current.length,
    priorNightsLogged: previous.length,
    longest,
    shortest,
  };
}

/**
 * Exercise for both periods.
 *
 * **The headline counts days trained, not workout rows.** `workouts` holds
 * one row per exercise performed, so a single gym session with eight
 * exercises is eight rows — "412 workouts" and "180 days trained" are both
 * derivable from that table and only one of them is what a person means by
 * "how much did I train this year". The row count is still returned, as
 * supporting detail rather than the number on the card, because it does
 * say something about session volume; it just shouldn't be the claim.
 */
async function getExercise(period: RecapPeriod, prior: RecapPeriod): Promise<RecapExercise> {
  const db = getDb();
  const rows = await db
    .select({ date: workouts.date })
    .from(workouts)
    .where(and(gte(workouts.date, prior.start), lte(workouts.date, period.end)));

  return summarizeExercise(rows, period, prior);
}

export function summarizeExercise(
  rows: { date: string }[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapExercise {
  const current = rows.filter((row) => inPeriod(row.date, period));
  const previous = rows.filter((row) => inPeriod(row.date, prior));

  return {
    daysTrained: new Set(current.map((row) => row.date)).size,
    priorDaysTrained: new Set(previous.map((row) => row.date)).size,
    exercisesLogged: current.length,
  };
}

export async function getRecapHealth(
  period: RecapPeriod,
  prior: RecapPeriod
): Promise<RecapHealth> {
  const [happiness, sleep, exercise] = await Promise.all([
    getHappiness(period, prior),
    getSleep(period, prior),
    getExercise(period, prior),
  ]);
  return { happiness, sleep, exercise };
}
