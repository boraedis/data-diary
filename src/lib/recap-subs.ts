import { and, gte, lte } from "drizzle-orm";
import { days } from "@/db/schema";
import { getDb } from "@/lib/db";
import { SUB_NAMES } from "@/lib/days";
import type { RecapPeriod } from "@/lib/recap";

// The recap's subs section (issue #170, epic #130).
//
// The issue originally framed this as "mood & wellbeing" alongside
// happiness and sleep. It isn't: these columns are the tracked subs, and
// the section is named for what they are. Happiness, sleep and exercise
// moved to #201.
//
// **Direction matters here, and it only points one way.** For every sub,
// more is worse and less is better — A is alcohol, and the rest follow.
// That single fact drives the framing: a lower average is an improvement,
// the "biggest mover" card has to say which way it moved rather than just
// how far, and nothing here is neutral the way a movie count is.
//
// It's expressed in words, never color. This app has no status palette —
// `--chart-1..5` are the fixed categorical slots and `--destructive` means
// error — and adding one is a palette change this repo validates first (see
// AGENTS.md, and the same decision recorded in the recap stat card from
// #179).

/**
 * The three subs the recap reports on, out of the nine `SUB_NAMES` the day
 * form tracks.
 *
 * Not every tracked value is worth a year-end card. These three are the
 * ones that carry real signal across a year; the other six are logged but
 * sit at zero for most of it, and six near-empty rows made the section read
 * as a sparse table rather than a highlight. They're still recorded and
 * still on the day form — this is an editorial choice about the recap, not
 * a change to what gets tracked.
 */
export const RECAP_SUB_NAMES = ["A", "W", "Ni"] as const;

/** Index of each reported sub within `SUB_NAMES` / the column list below. */
const REPORTED_INDEXES = RECAP_SUB_NAMES.map((name) => SUB_NAMES.indexOf(name));

/** A day's values for the reported subs, in `RECAP_SUB_NAMES` order. `null`
 * means the sub was left blank that day — not logged, which is different
 * from a logged zero (the entry form has a "fill blanks with zero" button
 * precisely because those are different acts, and an average must not treat
 * a blank as a zero). */
export type RecapSubDay = { date: string; values: (number | null)[] };

/**
 * The `days` columns holding each sub, in `SUB_NAMES` order.
 *
 * Mirrors the private `SUB_COLUMNS` list in `src/lib/days.ts` — that one
 * isn't exported, and re-deriving the mapping here is better than widening
 * that module's API for a read-only consumer.
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
  /** Mean logged value over the period, or null when nothing was logged.
   *
   * Zeros are included. A year's average is meant to answer "how much of
   * this, day to day", and dropping the zero days would answer a different
   * question — "how heavy was it when it happened" — which reads as an
   * improvement in exactly the years you did it less often. Blanks are
   * excluded, because a day nobody filled in is unknown, not a zero. */
  average: number | null;
  priorAverage: number | null;
  /** Days with a logged value — the denominator, and the coverage number
   * the shared insufficient-data rule is applied against. */
  daysLogged: number;
  priorDaysLogged: number;
};

export type RecapSubMover = {
  name: string;
  /** Negative when the average fell, which for these is the good direction. */
  change: number;
  average: number;
  priorAverage: number;
};

export type RecapSubs = {
  summaries: RecapSubSummary[];
  /** The sub whose average fell the most, and the one that rose the most.
   * Either can be null — with no prior period there's nothing to move
   * against, and a period where nothing went a given way has no mover. */
  mostImproved: RecapSubMover | null;
  biggestIncrease: RecapSubMover | null;
  /** Days in the period with any reported sub logged. Coverage for the
   * section as a whole — subs started being logged partway through this
   * app's history, so an early year has none of this rather than zeros. */
  daysWithSubData: number;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * The whole section, from day rows spanning both periods.
 *
 * Exported and pure: the rules worth getting right — what the average is
 * taken over, which direction counts as improvement, when a comparison is
 * allowed at all — are here, and none of them need a database to test.
 */
export function buildRecapSubs(
  rows: RecapSubDay[],
  period: RecapPeriod,
  prior: RecapPeriod
): RecapSubs {
  const inPeriod = (date: string, p: RecapPeriod) => date >= p.start && date <= p.end;
  const current = rows.filter((row) => inPeriod(row.date, period));
  const previous = rows.filter((row) => inPeriod(row.date, prior));

  const logged = (source: RecapSubDay[], index: number): number[] =>
    source.map((day) => day.values[index]).filter((value): value is number => value !== null);

  const summaries: RecapSubSummary[] = RECAP_SUB_NAMES.map((name, index) => {
    const values = logged(current, index);
    const priorValues = logged(previous, index);
    return {
      name,
      average: mean(values),
      priorAverage: mean(priorValues),
      daysLogged: values.length,
      priorDaysLogged: priorValues.length,
    };
  });

  // A sub only qualifies as a "mover" if both periods actually logged it.
  // Otherwise a fall to nothing is a change in what got recorded, not in
  // what happened, and calling that "most improved" would be congratulating
  // someone for stopping tracking.
  const movers: RecapSubMover[] = summaries
    .filter(
      (s): s is RecapSubSummary & { average: number; priorAverage: number } =>
        s.average !== null && s.priorAverage !== null
    )
    .map((s) => ({
      name: s.name,
      change: s.average - s.priorAverage,
      average: s.average,
      priorAverage: s.priorAverage,
    }))
    .sort((a, b) => a.change - b.change);

  return {
    summaries,
    mostImproved: movers.find((m) => m.change < 0) ?? null,
    biggestIncrease: [...movers].reverse().find((m) => m.change > 0) ?? null,
    daysWithSubData: current.filter((day) => day.values.some((value) => value !== null)).length,
  };
}

/**
 * Reads both periods in one query — the prior period always sits directly
 * before the current one, so a single range covers them and the fold splits
 * them apart.
 *
 * All nine columns are selected and then narrowed to the reported three, so
 * the column mapping stays aligned with `SUB_NAMES` by construction rather
 * than by a second hand-maintained list.
 */
export async function getRecapSubs(period: RecapPeriod, prior: RecapPeriod): Promise<RecapSubs> {
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
    rows.map((row) => {
      const all = [row.a, row.w, row.c, row.l, row.ni, row.no, row.ad, row.d, row.k];
      return { date: row.date, values: REPORTED_INDEXES.map((index) => all[index]) };
    }),
    period,
    prior
  );
}
