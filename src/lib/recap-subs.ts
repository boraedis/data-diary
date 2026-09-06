import { and, gte, lte } from "drizzle-orm";
import { days } from "@/db/schema";
import { addDays } from "@/lib/date";
import { getDb } from "@/lib/db";
import { SUB_NAMES } from "@/lib/days";
import type { RecapPeriod } from "@/lib/recap";

// The recap's subs section (issue #170, epic #130).
//
// The issue originally framed this as "mood & wellbeing" alongside
// happiness and sleep. It isn't: these nine columns are the tracked subs,
// and the section is named for what they are.
//
// **Direction matters here, and it only points one way.** For every one of
// the nine, more is worse and less is better — A is alcohol, and the rest
// follow. That single fact drives all the framing below: a year with fewer
// logged days of something is an improvement, the "biggest mover" card has
// to say *which way* it moved rather than just how far, and a streak is
// worth counting when it's a run of days at zero. Nothing here is neutral
// the way a movie count is, and it would read badly if it pretended to be.
//
// It's expressed in words, never color. This app has no status palette —
// `--chart-1..5` are the fixed categorical slots and `--destructive` means
// error — and adding one is a palette change this repo validates first (see
// AGENTS.md, and the same decision recorded in the recap stat card from
// #179).

/** A day's nine sub values, in `SUB_NAMES` order. `null` means the sub was
 * left blank that day — not logged, which is different from a logged zero
 * (the entry form has a "fill blanks with zero" button precisely because
 * those are different acts). */
export type RecapSubDay = { date: string; values: (number | null)[] };

/**
 * The `days` columns holding each sub, in `SUB_NAMES` order.
 *
 * Mirrors the private `SUB_COLUMNS` list in `src/lib/days.ts` — that one
 * isn't exported, and re-deriving the mapping here is better than widening
 * that module's API for a read-only consumer. If the nine ever change, they
 * change in both places; `SUB_NAMES` is the shared source for the names
 * themselves, so a mismatch in *length* would surface immediately below.
 */
const SUB_COLUMNS = [
  days.subA,
  days.subW,
  days.subC,
  days.subL,
  days.subNi,
  days.subNO,
  days.subAd,
  days.subD,
  days.subK,
] as const;

export type RecapSubSummary = {
  name: string;
  /** Days in the period where this sub was logged above zero. The headline
   * metric: concrete, comparable across periods, and unaffected by how
   * intensity was scored on a given day. */
  daysWithAny: number;
  priorDaysWithAny: number;
  /** Days where this sub was logged at all — the denominator, and the
   * coverage number the shared insufficient-data rule is applied against. */
  daysLogged: number;
  priorDaysLogged: number;
};

export type RecapSubMover = {
  name: string;
  /** Negative when the sub happened on fewer days than last period, which
   * for these nine is the good direction. */
  change: number;
  daysWithAny: number;
  priorDaysWithAny: number;
};

export type RecapSubs = {
  summaries: RecapSubSummary[];
  /** The sub that fell the most, and the one that rose the most. Either can
   * be null — with no prior period there's nothing to move against, and a
   * period where nothing changed in a given direction has no mover. */
  mostImproved: RecapSubMover | null;
  biggestIncrease: RecapSubMover | null;
  cleanDays: { total: number; priorTotal: number };
  longestCleanStreak: { length: number; start: string | null; end: string | null };
  /** Days in the period with any sub data at all. Coverage for the section
   * as a whole — subs started being logged partway through this app's
   * history, so an early year has none of this rather than nine zeros. */
  daysWithSubData: number;
  priorDaysWithSubData: number;
};

/**
 * A day counts as clean when all nine subs were logged and every one is
 * zero.
 *
 * The strict reading is the honest one. A day with three zeros and six
 * blanks isn't evidence of a clean day — it's evidence of a
 * partially-filled form, and counting it would quietly inflate both the
 * clean-day total and the streak below. Blank means unknown, and unknown is
 * never counted as good news. The entry form's "fill blanks with zero"
 * button exists exactly so that a genuinely clean day can be recorded as
 * one.
 */
function isCleanDay(day: RecapSubDay): boolean {
  return day.values.every((value) => value === 0);
}

/** Whether the day carries any sub data at all. */
function hasSubData(day: RecapSubDay): boolean {
  return day.values.some((value) => value !== null);
}

/**
 * Longest run of consecutive clean days inside the period.
 *
 * **An unlogged day breaks the streak.** The alternative — skipping over
 * gaps so a run continues across them — was rejected: it would report the
 * longest streaks for the years with the *worst* logging, since every
 * missing day would silently extend a run rather than end it. Breaking on a
 * gap can only understate the streak, and understating is the safe
 * direction for a number being handed to someone as an achievement.
 *
 * "Consecutive" is calendar-consecutive, not row-consecutive: a missing row
 * is a gap in the same way an unclean day is, so the run is walked by date
 * rather than by array index.
 */
export function longestCleanStreak(
  daysInPeriod: RecapSubDay[],
  period: RecapPeriod
): { length: number; start: string | null; end: string | null } {
  const cleanByDate = new Map(daysInPeriod.map((day) => [day.date, isCleanDay(day)]));

  let best = { length: 0, start: null as string | null, end: null as string | null };
  let runStart: string | null = null;
  let runLength = 0;

  for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
    if (cleanByDate.get(date) === true) {
      if (runStart === null) runStart = date;
      runLength += 1;
      if (runLength > best.length) best = { length: runLength, start: runStart, end: date };
    } else {
      runStart = null;
      runLength = 0;
    }
  }

  return best;
}

/**
 * The whole section, from day rows spanning both periods.
 *
 * Exported and pure: the rules worth getting right — what a clean day is,
 * what breaks a streak, which direction counts as improvement — are all
 * here, and none of them need a database to test.
 */
export function buildRecapSubs(
  rows: RecapSubDay[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapSubs {
  const inPeriod = (date: string, p: RecapPeriod) => date >= p.start && date <= p.end;
  const current = rows.filter((row) => inPeriod(row.date, period));
  const previous = rows.filter((row) => inPeriod(row.date, prior));

  const summaries: RecapSubSummary[] = SUB_NAMES.map((name, index) => ({
    name,
    daysWithAny: current.filter((day) => (day.values[index] ?? 0) > 0).length,
    priorDaysWithAny: previous.filter((day) => (day.values[index] ?? 0) > 0).length,
    daysLogged: current.filter((day) => day.values[index] !== null).length,
    priorDaysLogged: previous.filter((day) => day.values[index] !== null).length,
  }));

  // A sub only qualifies as a "mover" if both periods actually logged it —
  // otherwise the drop from 40 days to 0 is a change in what got recorded,
  // not a change in what happened, and calling that "most improved" would
  // be congratulating someone for stopping tracking.
  const comparable = summaries.filter((s) => s.daysLogged > 0 && s.priorDaysLogged > 0);
  const movers: RecapSubMover[] = comparable
    .map((s) => ({
      name: s.name,
      change: s.daysWithAny - s.priorDaysWithAny,
      daysWithAny: s.daysWithAny,
      priorDaysWithAny: s.priorDaysWithAny,
    }))
    .sort((a, b) => a.change - b.change);

  const fell = movers.find((m) => m.change < 0) ?? null;
  const rose = [...movers].reverse().find((m) => m.change > 0) ?? null;

  return {
    summaries,
    mostImproved: fell,
    biggestIncrease: rose,
    cleanDays: {
      total: current.filter(isCleanDay).length,
      priorTotal: previous.filter(isCleanDay).length,
    },
    longestCleanStreak: longestCleanStreak(current, period),
    daysWithSubData: current.filter(hasSubData).length,
    priorDaysWithSubData: previous.filter(hasSubData).length,
  };
}

/**
 * Reads both periods in one query — the prior period always sits directly
 * before the current one, so a single range covers them and the fold splits
 * them apart.
 */
export async function getRecapSubs(
  period: RecapPeriod,
  prior: RecapPeriod
): Promise<RecapSubs> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      a: SUB_COLUMNS[0],
      w: SUB_COLUMNS[1],
      c: SUB_COLUMNS[2],
      l: SUB_COLUMNS[3],
      ni: SUB_COLUMNS[4],
      no: SUB_COLUMNS[5],
      ad: SUB_COLUMNS[6],
      d: SUB_COLUMNS[7],
      k: SUB_COLUMNS[8],
    })
    .from(days)
    .where(and(gte(days.date, prior.start), lte(days.date, period.end)));

  return buildRecapSubs(
    rows.map((row) => ({
      date: row.date,
      values: [row.a, row.w, row.c, row.l, row.ni, row.no, row.ad, row.d, row.k],
    })),
    period,
    prior
  );
}
