import { addDays, daysBetween } from "@/lib/date";
import { groupByPeriod, type Period } from "@/lib/viz/bin";

// The per-item "how often does this show up" series behind every manage
// detail page's prevalence chart (#590). Same boundary as bin.ts: one
// item's history is already on the page (the `get*Usage` functions return
// it for the mentions list), so this re-buckets those rows rather than
// asking SQL for a second, aggregated copy.

/** The picker's windows, each ending today. "all" runs from the item's
 * first appearance. */
export type PrevalenceWindow = "all" | "1y" | "1m" | "1w";

/**
 * What a bucket's value means.
 *
 * - "days": how many distinct days the item appears on. Distinct, not raw
 *   rows, because several of the sources log more than one row per day (an
 *   exercise focus hit by two workouts, a place in both day slots) and the
 *   question the chart answers is "how many days", not "how many rows".
 * - "minutes": the summed `durationMinutes` of every entry — a game's
 *   logged play time, where a single two-hour session and a ten-minute one
 *   shouldn't count the same. A session with no duration adds nothing.
 */
export type PrevalenceMeasure = "days" | "minutes";

/** A bare date, or any usage row carrying one. Rows are taken as-is (a
 * game's `sessions`, a movie's `watches`) so a page can hand over the
 * array it already has rather than mapping a fresh copy every render. A
 * row with no date (a TV episode marked watched without saying when)
 * can't be placed on a timeline and is skipped. */
export type PrevalenceEntry = string | { date: string | null; durationMinutes?: number | null };

type DatedEntry = string | { date: string; durationMinutes?: number | null };

const dateOf = (e: DatedEntry) => (typeof e === "string" ? e : e.date);
const minutesOf = (e: DatedEntry) => (typeof e === "string" ? 0 : (e.durationMinutes ?? 0));

export type PrevalencePoint = { start: string; value: number };

/** Bucket size follows the window, so each one draws a few dozen to a few
 * hundred points: days for a week or month, weeks for a year, months for
 * all-time. "day" isn't a bin.ts `Period` — a day is its own bucket. */
export function prevalenceBucket(window: PrevalenceWindow): Period | "day" {
  switch (window) {
    case "all":
      return "month";
    case "1y":
      return "week";
    case "1m":
    case "1w":
      return "day";
  }
}

/** The first day inside `window`, counting `today` as its last. Calendar
 * months and years rather than 30/365 days, so "1M" on Mar 15 starts on
 * Feb 16 the way a reader would count it. `null` for "all", whose start is
 * the data's own. */
export function prevalenceWindowStart(window: PrevalenceWindow, today: string): string | null {
  const [y, m, d] = today.split("-").map(Number);
  // Date.UTC normalizes an overflowed day (Mar 31 minus a month is "Feb
  // 31", i.e. early March), which keeps the window at least a month long.
  const shifted = (years: number, months: number) => {
    const dt = new Date(Date.UTC(y - years, m - 1 - months, d));
    return addDays(dt.toISOString().slice(0, 10), 1);
  };
  switch (window) {
    case "all":
      return null;
    case "1y":
      return shifted(1, 0);
    case "1m":
      return shifted(0, 1);
    case "1w":
      return addDays(today, -6);
  }
}

/**
 * One point per bucket from the window's start (or the first entry, for
 * "all") through today, with empty buckets filled in as 0. The zeros
 * matter: a line drawn only through buckets that have entries would slope
 * straight across a three-year gap as if the item had been tapering off
 * the whole time, when the real reading is "gone, then back".
 *
 * Returns `[]` when `entries` holds no dated rows — the caller's empty state, rather
 * than a flat line at zero. A window that's empty for an item that does
 * have history still returns its zero-filled line, since "not once this
 * month" is a real answer for that item.
 */
export function buildPrevalenceSeries(
  entries: readonly PrevalenceEntry[],
  window: PrevalenceWindow,
  measure: PrevalenceMeasure,
  today: string
): PrevalencePoint[] {
  const dated = entries.filter((e): e is DatedEntry => typeof e === "string" || e.date !== null);
  if (dated.length === 0) return [];

  const first = dated.reduce<string>((min, e) => (dateOf(e) < min ? dateOf(e) : min), dateOf(dated[0]));
  const start = prevalenceWindowStart(window, today) ?? first;
  // Only possible for "all" with every entry dated after today.
  if (start > today) return [];

  const inWindow = dated.filter((e) => dateOf(e) >= start && dateOf(e) <= today);
  const valueOf = (items: readonly DatedEntry[]) =>
    measure === "days" ? new Set(items.map(dateOf)).size : items.reduce((sum, e) => sum + minutesOf(e), 0);

  // Every calendar day in range, bucketed the same way as the entries,
  // gives the full run of bucket starts (gaps included) without a second
  // copy of bin.ts's week/month boundary rules. All-time over this app's
  // history is a few thousand days, cheap to walk.
  const bucket = prevalenceBucket(window);
  const allDays = Array.from({ length: daysBetween(start, today) + 1 }, (_, i) => addDays(start, i));
  if (bucket === "day") {
    const byDay = new Map<string, DatedEntry[]>();
    for (const e of inWindow) byDay.set(dateOf(e), [...(byDay.get(dateOf(e)) ?? []), e]);
    return allDays.map((date) => ({ start: date, value: valueOf(byDay.get(date) ?? []) }));
  }
  const byBucket = new Map(groupByPeriod(inWindow, bucket, dateOf).map((b) => [b.key, b.items]));
  return groupByPeriod(allDays, bucket, (d) => d).map((b) => ({ start: b.start, value: valueOf(byBucket.get(b.key) ?? []) }));
}
