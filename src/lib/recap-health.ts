import { and, asc, gte, isNotNull, lte } from "drizzle-orm";
import { days, workouts } from "@/db/schema";
import { getExerciseWorkoutRows, getSleepNightsData, type ExerciseWorkoutRow, type SleepDay } from "@/lib/charts";
import { addDays } from "@/lib/date";
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

/**
 * A day scoring at or above this counts as a "good day" for the streak card.
 *
 * A fixed score rather than a percentile of the period (the moments engine's
 * approach): scores sit against a ceiling of 100 — a typical year averages
 * ~88 — so a per-period percentile would hand a bad year its own "good"
 * days and make the streak mean "your best days, relative to themselves".
 * A fixed bar means the same thing every period, so the streak is
 * comparable to the prior one. 80 is deliberately unambitious given that
 * average; it's an editorial constant, exported so it can be argued with.
 */
export const GOOD_DAY_THRESHOLD = 80;

/** A run of consecutive good days. `end` is the last good day, inclusive. */
export type GoodDayStreak = { length: number; start: string; end: string };

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
  /** Longest run of consecutive good days inside the period, null when none
   * scored at or above `GOOD_DAY_THRESHOLD`. See `longestGoodStreak`. */
  streak: GoodDayStreak | null;
  priorStreak: GoodDayStreak | null;
  /** The period's scored days, oldest first, for the trend chart. Date and
   * score only, like `best`/`worst`. */
  series: HappinessDay[];
};

export type RecapSleep = {
  averageMinutes: number | null;
  priorAverageMinutes: number | null;
  nightsLogged: number;
  priorNightsLogged: number;
  longest: SleepDay | null;
  shortest: SleepDay | null;
  /** Where the nights were slept (#531). See `summarizeSleepLocations`. */
  locations: RecapSleepLocations;
  /** Naps, reported apart from nights (#531). See `summarizeNaps`. */
  naps: RecapNaps;
};

/**
 * A night as the recap reads it: the public chart's narrow `SleepDay`, plus
 * where it was slept and that day's nap. Its own type rather than a widened
 * `SleepDay`, which the public sleep chart renders and which mustn't learn
 * where anyone sleeps (see `SleepNight`'s comment in charts.ts). The two
 * extra fields are optional so a plain `SleepDay` still reads as a night
 * with neither recorded.
 */
export type RecapSleepNight = SleepDay & {
  locationType?: string | null;
  napMinutes?: number | null;
};

/** One location type's nights in each period. A period with no nights
 * there has `nights: 0` and a null average. */
export type RecapSleepLocationRow = {
  /** The `sleepLocationType` value, or "Other" for the folded tail. */
  label: string;
  /** True for the folded tail row, which always sorts last. */
  other: boolean;
  /** Fixed categorical slot: rank order among the named rows, so the
   * colours never cycle and the "Other" row gets the slot past the five
   * real ones (the muted grey). */
  colorIndex: number;
  nights: number;
  averageMinutes: number | null;
  priorNights: number;
  priorAverageMinutes: number | null;
};

export type RecapSleepLocations = {
  /** Ranked by nights this period, then prior-period nights, then name.
   * Only nights with a recorded location. An unrecorded night is coverage,
   * never a location to rank. */
  rows: RecapSleepLocationRow[];
  /** Nights this period with a recorded location, out of `nightsLogged`. */
  locatedNights: number;
  priorLocatedNights: number;
};

export type RecapNaps = {
  totalMinutes: number;
  /** Days with a nap of more than zero minutes. */
  daysWithNap: number;
  priorTotalMinutes: number;
  priorDaysWithNap: number;
};

/** Named location rows before the rest fold into "Other". Five is the
 * number of real categorical slots, so every named row has its own hue and
 * "Other" takes the shared grey past them. */
export const SLEEP_LOCATION_SLOTS = 5;

export type RecapExercise = {
  /** Days with at least one workout logged — see the note on the fetcher
   * for why this, and not the row count. */
  daysTrained: number;
  priorDaysTrained: number;
  /** Individual exercises performed. Shown as supporting detail, never as
   * the headline, because it's the number that flatters. */
  exercisesLogged: number;
  /** The period's workouts in the exact shape the Exercise Mix chart takes
   * (hours per exercise, oldest first). */
  mix: ExerciseWorkoutRow[];
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

/**
 * The longest run of consecutive calendar days scoring at or above
 * `GOOD_DAY_THRESHOLD`, counting only days inside `period`.
 *
 * **An unlogged day breaks a run.** A missing day isn't known to be good, and
 * bridging gaps would let a sparsely-logged year show a long streak it never
 * verified — so the streak is also a statement about logging consistency.
 * Consequently a period with few logged days can't produce a long one, which
 * is correct, and callers gate the card on `MIN_DAYS_FOR_AVERAGE`.
 *
 * Ties go to the earliest run (strict comparison, ascending input).
 */
export function longestGoodStreak(scored: HappinessDay[], period: RecapPeriod): GoodDayStreak | null {
  let best: GoodDayStreak | null = null;
  let run: GoodDayStreak | null = null;
  for (const day of scored) {
    if (!inPeriod(day.date, period)) continue;
    if (day.happiness < GOOD_DAY_THRESHOLD) {
      run = null;
      continue;
    }
    run =
      run !== null && addDays(run.end, 1) === day.date
        ? { length: run.length + 1, start: run.start, end: day.date }
        : { length: 1, start: day.date, end: day.date };
    if (best === null || run.length > best.length) best = run;
  }
  return best;
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
    streak: longestGoodStreak(current, period),
    priorStreak: longestGoodStreak(previous, prior),
    series: current,
  };
}

/**
 * Sleep for both periods.
 *
 * Reuses `getSleepNightsData` (the private chart's derivation, which also
 * carries each night's location and nap for #531) rather than re-deriving
 * duration from
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
  return summarizeSleep(await getSleepNightsData(), period, prior);
}

/**
 * Sleep for both periods.
 *
 * **A night belongs to the period holding its `days` row date**, for its
 * duration, its location and its nap alike, so all three always agree on
 * which nights a period has.
 */
export function summarizeSleep(
  nights: RecapSleepNight[],
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
    // Date and duration only, whatever extra fields the input carried: these
    // two are rendered as-is, and a night's location has its own card.
    longest: longest && { date: longest.date, durationMinutes: longest.durationMinutes },
    shortest: shortest && { date: shortest.date, durationMinutes: shortest.durationMinutes },
    locations: summarizeSleepLocations(current, previous),
    naps: summarizeNaps(current, previous),
  };
}

/**
 * Nights and average duration per sleep location type, this period beside
 * the prior one.
 *
 * A null `locationType` is "not recorded" and is counted only in coverage
 * (`locatedNights` out of `nightsLogged`), never ranked: it isn't a place,
 * and ranking it would put "unknown" at the top of most years. The ranking
 * is by this period's nights. A location only slept at in the prior period
 * still gets a row (0 nights now), since its absence is part of the
 * comparison. Past `SLEEP_LOCATION_SLOTS` named rows, the rest fold into
 * one "Other" row whose average is taken over its own nights, not averaged
 * from the rows it replaced.
 *
 * The subtype drill-down isn't repeated here; the report links to
 * `/charts/sleep-locations` for it.
 */
export function summarizeSleepLocations(
  current: RecapSleepNight[],
  previous: RecapSleepNight[]
): RecapSleepLocations {
  const located = (list: RecapSleepNight[]) =>
    list.filter((n): n is RecapSleepNight & { locationType: string } => typeof n.locationType === "string");
  const now = located(current);
  const before = located(previous);

  const group = (list: { locationType: string; durationMinutes: number }[]) => {
    const map = new Map<string, number[]>();
    for (const n of list) map.set(n.locationType, [...(map.get(n.locationType) ?? []), n.durationMinutes]);
    return map;
  };
  const nowBy = group(now);
  const beforeBy = group(before);

  const labels = [...new Set([...nowBy.keys(), ...beforeBy.keys()])].sort(
    (a, b) =>
      (nowBy.get(b)?.length ?? 0) - (nowBy.get(a)?.length ?? 0) ||
      (beforeBy.get(b)?.length ?? 0) - (beforeBy.get(a)?.length ?? 0) ||
      a.localeCompare(b)
  );

  // A tail of one isn't worth folding: it would only rename that location
  // "Other". So fold only when at least two rows would go into it.
  const foldFrom = labels.length > SLEEP_LOCATION_SLOTS + 1 ? SLEEP_LOCATION_SLOTS : labels.length;
  const named = labels.slice(0, foldFrom);
  const tail = new Set(labels.slice(foldFrom));

  const row = (label: string, other: boolean, colorIndex: number, nowMinutes: number[], beforeMinutes: number[]) => ({
    label,
    other,
    colorIndex,
    nights: nowMinutes.length,
    averageMinutes: mean(nowMinutes),
    priorNights: beforeMinutes.length,
    priorAverageMinutes: mean(beforeMinutes),
  });

  const rows: RecapSleepLocationRow[] = named.map((label, i) =>
    row(label, false, i, nowBy.get(label) ?? [], beforeBy.get(label) ?? [])
  );
  if (tail.size > 0) {
    rows.push(
      row(
        "Other",
        true,
        SLEEP_LOCATION_SLOTS,
        now.filter((n) => tail.has(n.locationType)).map((n) => n.durationMinutes),
        before.filter((n) => tail.has(n.locationType)).map((n) => n.durationMinutes)
      )
    );
  }

  return { rows, locatedNights: now.length, priorLocatedNights: before.length };
}

/**
 * Nap time and days napped, per period.
 *
 * **A nap never counts as a night** and never changes a night's duration:
 * it only adds to this total. It's attributed by its own row's date, like
 * everything else here.
 *
 * Known gap: naps arrive through `getSleepNightsData`, which keeps only
 * rows with both a sleep and a wake time. A nap logged on a day whose
 * night wasn't is missed. That's rare in practice, and #531 chose reuse of
 * the one sleep derivation over a second query.
 */
export function summarizeNaps(current: RecapSleepNight[], previous: RecapSleepNight[]): RecapNaps {
  const napped = (list: RecapSleepNight[]) => list.map((n) => n.napMinutes ?? 0).filter((m) => m > 0);
  const now = napped(current);
  const before = napped(previous);
  const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
  return {
    totalMinutes: sum(now),
    daysWithNap: now.length,
    priorTotalMinutes: sum(before),
    priorDaysWithNap: before.length,
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
  const [rows, mixRows] = await Promise.all([
    db
      .select({ date: workouts.date })
      .from(workouts)
      .where(and(gte(workouts.date, prior.start), lte(workouts.date, period.end))),
    // Filtered in memory, like sleep above: the hours-per-workout fallback
    // (set durations when a workout has no duration of its own) lives in
    // `getExerciseWorkoutRows` and shouldn't be re-derived here.
    getExerciseWorkoutRows(),
  ]);

  return summarizeExercise(
    rows,
    period,
    prior,
    mixRows.filter((row) => inPeriod(row.date, period))
  );
}

export function summarizeExercise(
  rows: { date: string }[],
  period: RecapPeriod,
  prior: RecapPeriod,
  mix: ExerciseWorkoutRow[] = []
): RecapExercise {
  const current = rows.filter((row) => inPeriod(row.date, period));
  const previous = rows.filter((row) => inPeriod(row.date, prior));

  return {
    daysTrained: new Set(current.map((row) => row.date)).size,
    priorDaysTrained: new Set(previous.map((row) => row.date)).size,
    exercisesLogged: current.length,
    mix,
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
