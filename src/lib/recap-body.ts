import { and, asc, gte, lte } from "drizzle-orm";
import { days } from "@/db/schema";
import { getExerciseWorkoutRows, type ExerciseWorkoutRow } from "@/lib/charts";
import { getDb } from "@/lib/db";
import type { RecapPeriod } from "@/lib/recap";

// The recap's body & habits section (#529, slice 3 of #521): weight,
// coffee, distance walked and training volume.
//
// Like the health section, nothing here carries a good/bad direction the
// recap should assert — losing weight, drinking less coffee or walking
// further are each good for some people in some years — so every card is
// neutral and the delta is stated in words only.
//
// **"Not enough data" is about logged days, not the calendar.** All three
// `days` columns are nullable and a null means "not recorded", so a total
// over a sparsely-logged period would quietly understate it. That's why
// coffee and distance lead with a *per-logged-day average* (comparable
// across periods with different coverage) and carry the total as detail,
// and why every card is gated on `MIN_DAYS_FOR_AVERAGE` logged days.
// Training hours are the exception: a sum of timed workouts is a count of
// things that happened, honest at any coverage, so it's gated on
// `MIN_DAYS_FOR_TOTAL` like the other totals.

export type DatedValue = { date: string; value: number };

/** A nullable numeric `days` column summarised over a period and its
 * prior. */
export type RecapDailyMetric = {
  /** Mean over days the column was recorded, null when none were. */
  average: number | null;
  priorAverage: number | null;
  /** Days the column was recorded — the coverage number every card gates
   * on. */
  daysLogged: number;
  priorDaysLogged: number;
  /** Sum over those logged days. Only ever shown *beside* the average. */
  total: number;
};

export type RecapWeight = RecapDailyMetric & {
  /** First and last weigh-in in the period. The "start vs. end" reading
   * the average alone can't give; shown as detail, not as a headline
   * verdict, since which direction is good depends on the person. */
  first: DatedValue | null;
  last: DatedValue | null;
  /** The period's weigh-ins, oldest first, for the trend chart. */
  series: DatedValue[];
};

export type RecapTraining = {
  /** Hours of *timed* workouts. A workout with no duration and no timed
   * sets contributes nothing (`getExerciseWorkoutRows`'s own fallback),
   * which is stated on the card rather than hidden. */
  hours: number;
  priorHours: number;
  /** Distinct days with at least one timed workout. */
  daysTrained: number;
  priorDaysTrained: number;
};

export type RecapBody = {
  weight: RecapWeight;
  coffee: RecapDailyMetric;
  distance: RecapDailyMetric;
  training: RecapTraining;
};

function inPeriod(date: string, period: RecapPeriod): boolean {
  return date >= period.start && date <= period.end;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Exported and pure: the period split is the whole rule. */
export function summarizeDaily(
  values: DatedValue[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapDailyMetric {
  const current = values.filter((v) => inPeriod(v.date, period));
  const previous = values.filter((v) => inPeriod(v.date, prior));
  return {
    average: mean(current.map((v) => v.value)),
    priorAverage: mean(previous.map((v) => v.value)),
    daysLogged: current.length,
    priorDaysLogged: previous.length,
    total: current.reduce((sum, v) => sum + v.value, 0),
  };
}

/** `values` must be ascending by date, as the query returns them. */
export function summarizeWeight(
  values: DatedValue[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapWeight {
  const series = values.filter((v) => inPeriod(v.date, period));
  return {
    ...summarizeDaily(values, period, prior),
    first: series[0] ?? null,
    last: series[series.length - 1] ?? null,
    series,
  };
}

export function summarizeTraining(
  rows: Pick<ExerciseWorkoutRow, "date" | "hours">[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapTraining {
  const timed = rows.filter((row) => row.hours > 0);
  const current = timed.filter((row) => inPeriod(row.date, period));
  const previous = timed.filter((row) => inPeriod(row.date, prior));
  const sum = (list: typeof timed) => list.reduce((total, row) => total + row.hours, 0);
  return {
    hours: sum(current),
    priorHours: sum(previous),
    daysTrained: new Set(current.map((row) => row.date)).size,
    priorDaysTrained: new Set(previous.map((row) => row.date)).size,
  };
}

export async function getRecapBody(period: RecapPeriod, prior: RecapPeriod): Promise<RecapBody> {
  const db = getDb();
  const [rows, workoutRows] = await Promise.all([
    db
      .select({
        date: days.date,
        weight: days.weightKg,
        coffees: days.coffees,
        distance: days.distanceWalkedKm,
      })
      .from(days)
      .where(and(gte(days.date, prior.start), lte(days.date, period.end)))
      .orderBy(asc(days.date)),
    // All-time read filtered in memory, as the health section does: the
    // hours fallback lives in `getExerciseWorkoutRows` and isn't worth
    // re-deriving.
    getExerciseWorkoutRows(),
  ]);

  const column = (pick: (row: (typeof rows)[number]) => number | null): DatedValue[] =>
    rows.flatMap((row) => {
      const value = pick(row);
      return value === null ? [] : [{ date: row.date, value }];
    });

  return {
    weight: summarizeWeight(column((r) => r.weight), period, prior),
    coffee: summarizeDaily(column((r) => r.coffees), period, prior),
    distance: summarizeDaily(column((r) => r.distance), period, prior),
    training: summarizeTraining(workoutRows, period, prior),
  };
}
