import type { DayType } from "@/db/schema";
import { parseDate } from "@/lib/date";

// Pure "which side of a two-way comparison is this day on" rules, for the
// split histograms (Happiness Histogram, Sleep Histogram). No React and no
// DB, so the rules are unit-testable — the same split `work.ts` keeps from
// the Work charts.
//
// Deliberately two-way splits only. A per-day-type split (work, day off,
// vacation, travel, jobless, sick) is six groups — more than the five real
// categorical slots — and several of them are a few dozen days, which is
// too thin to read as a distribution next to thousands of work days. Work
// vs. Happiness already compares every day type's *average*, where a thin
// group gets an honest confidence interval instead of a spiky shape.

export type DaySplit = "none" | "work" | "weekend";

/** A day that can be split: its date, and its day type when one was
 * recorded. */
export type SplittableDay = { date: string; dayType: DayType | null };

export type DaySplitGroup<T> = { id: string; label: string; days: T[] };

/** The two sides of each split, in fixed order — the first side gets the
 * first series color on every page, so "Work days" and "Weekdays" read the
 * same way across charts. */
export const DAY_SPLIT_SIDES: Record<Exclude<DaySplit, "none">, readonly [{ id: string; label: string }, { id: string; label: string }]> = {
  work: [
    { id: "work", label: "Work days" },
    { id: "off", label: "Non-work days" },
  ],
  weekend: [
    { id: "weekday", label: "Weekdays" },
    { id: "weekend", label: "Weekends" },
  ],
};

/** Which side of `split` a day is on, or null when it can't be placed.
 *
 * - `work`: `dayType === "work"` against every other recorded type (day
 *   off, vacation, travel, jobless, sick). A day with no type is left out,
 *   not counted as "not work" — day types only start in 2020, and folding
 *   four years of untyped days into one side would make that side mostly
 *   "before day types existed".
 * - `weekend`: Saturday and Sunday against Monday–Friday, by the calendar
 *   alone — so it covers every day logged, typed or not. */
export function daySplitSide(day: SplittableDay, split: Exclude<DaySplit, "none">): string | null {
  const [first, second] = DAY_SPLIT_SIDES[split];
  switch (split) {
    case "work":
      if (day.dayType === null) return null;
      return day.dayType === "work" ? first.id : second.id;
    case "weekend": {
      const dow = parseDate(day.date).getDay();
      return dow === 0 || dow === 6 ? second.id : first.id;
    }
  }
}

/** Id of the optional third group `splitDays` returns for days it can't
 * place on either side (see `includeUnplaced`). */
export const UNPLACED_GROUP_ID = "unplaced";

/** Splits `days` into the two sides of `split`, always both sides in fixed
 * order (an empty side stays, so its color slot and legend entry don't
 * move). `none` returns every day as one group.
 *
 * `includeUnplaced` adds the days neither side takes as a third group,
 * last — only when there are any, so the weekend split (which places every
 * day) never grows an empty legend entry. A stacked histogram needs this:
 * its bars are meant to add back up to the unsplit histogram, and the work
 * split alone drops every day before day types existed (all of 2016–2019
 * for happiness, over a third of it). */
export function splitDays<T extends SplittableDay>(
  days: readonly T[],
  split: DaySplit,
  { includeUnplaced = false }: { includeUnplaced?: boolean } = {},
): DaySplitGroup<T>[] {
  if (split === "none") return [{ id: "all", label: "All days", days: [...days] }];
  const groups = DAY_SPLIT_SIDES[split].map((side) => ({ ...side, days: [] as T[] }));
  const unplaced: T[] = [];
  for (const day of days) {
    const side = daySplitSide(day, split);
    if (side === null) unplaced.push(day);
    else groups.find((g) => g.id === side)?.days.push(day);
  }
  if (includeUnplaced && unplaced.length > 0) {
    groups.push({ id: UNPLACED_GROUP_ID, label: "Not recorded", days: unplaced });
  }
  return groups;
}
