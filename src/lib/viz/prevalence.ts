import { addDays, daysBetween } from "@/lib/date";
import { groupByPeriod, type Period } from "@/lib/viz/bin";

// The per-item "how often does this show up" series behind every manage
// detail page's prevalence chart (#590). Same boundary as bin.ts: one
// item's history is already on the page (the `get*Usage` functions return
// it for the mentions list), so this re-buckets those rows rather than
// asking SQL for a second, aggregated copy.

/** The picker's buckets, each spanning the item's whole history: how many
 * days per year, per month, or per week. */
export type PrevalencePeriod = Extract<Period, "year" | "month" | "week">;

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

/**
 * One point per `period` bucket from the item's first appearance through
 * today, with empty buckets filled in as 0. The zeros matter: a line
 * drawn only through buckets that have entries would slope straight
 * across a three-year gap as if the item had been tapering off the whole
 * time, when the real reading is "gone, then back".
 *
 * Returns `[]` when `entries` holds no dated rows: the caller's empty
 * state, rather than a flat line at zero.
 */
export function buildPrevalenceSeries(
  entries: readonly PrevalenceEntry[],
  period: PrevalencePeriod,
  measure: PrevalenceMeasure,
  today: string
): PrevalencePoint[] {
  const dated = entries.filter((e): e is DatedEntry => typeof e === "string" || e.date !== null);
  if (dated.length === 0) return [];

  const first = dated.reduce<string>((min, e) => (dateOf(e) < min ? dateOf(e) : min), dateOf(dated[0]));
  // Only possible with every entry dated after today.
  if (first > today) return [];

  const inRange = dated.filter((e) => dateOf(e) <= today);
  const valueOf = (items: readonly DatedEntry[]) =>
    measure === "days" ? new Set(items.map(dateOf)).size : items.reduce((sum, e) => sum + minutesOf(e), 0);

  // Every calendar day in range, bucketed the same way as the entries,
  // gives the full run of bucket starts (gaps included) without a second
  // copy of bin.ts's week/month boundary rules. A whole history is a few
  // thousand days, cheap to walk.
  const allDays = Array.from({ length: daysBetween(first, today) + 1 }, (_, i) => addDays(first, i));
  const byBucket = new Map(groupByPeriod(inRange, period, dateOf).map((b) => [b.key, b.items]));
  return groupByPeriod(allDays, period, (d) => d).map((b) => ({ start: b.start, value: valueOf(byBucket.get(b.key) ?? []) }));
}
