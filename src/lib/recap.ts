import { and, count, gte, lte, max, min, sql } from "drizzle-orm";
import { days } from "@/db/schema";
import { addDays, isValidDateString, parseDate } from "@/lib/date";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/viz/format";

// The recap epic's foundation (issue #169, epic #130). Three things live
// here and nowhere else, because every recap card depends on them agreeing:
// the period contract, how a prior period is derived, and when there simply
// isn't enough data for a card to say anything honest.
//
// Nothing here — and nothing any later recap sub-issue adds — takes a bare
// year. That's deliberate: #130 defers a monthly recap but requires the
// annual one be built so monthly is additive rather than a rewrite. A
// fetcher typed on `RecapPeriod` works for a month, a quarter, or an
// arbitrary window on the day it's written; a fetcher typed on `year: number`
// has to be reopened and re-tested for each one.

// --- The period contract ---------------------------------------------------

/** An inclusive calendar-date window plus how to name it in the UI.
 *
 * Both bounds are plain "YYYY-MM-DD" strings, matching the rest of this
 * codebase's date handling (`src/lib/date.ts`): no `Date` objects crossing
 * the server/client boundary, no epoch-day math. `days.date` and every
 * entertainment table's `date` column are `date` columns compared directly
 * against these strings, so the window needs no conversion to be queried. */
export type RecapPeriod = {
  /** Inclusive. */
  start: string;
  /** Inclusive. */
  end: string;
  /** Human-facing name — "2025", or a formatted range for a window that
   * isn't a whole calendar unit. */
  label: string;
};

/** The calendar year as a period. The only period constructor v1 needs;
 * a monthly equivalent belongs to the deferred monthly sub-issue (#176),
 * which should be able to add it without touching anything downstream. */
export function yearPeriod(year: number): RecapPeriod {
  return { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) };
}

/** True when a period covers exactly one whole calendar year. */
function isCalendarYear(period: RecapPeriod): boolean {
  const year = Number(period.start.slice(0, 4));
  const candidate = yearPeriod(year);
  return period.start === candidate.start && period.end === candidate.end;
}

/** Inclusive day count. */
export function periodLengthDays(period: RecapPeriod): number {
  const start = parseDate(period.start);
  const end = parseDate(period.end);
  // Rounded, not floored: a DST boundary inside the window makes the raw
  // millisecond difference an hour short of a whole number of days.
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * The comparison window a card's "vs. last year" line is measured against.
 *
 * A whole calendar year steps back to the whole previous calendar year
 * rather than shifting by its own day count — otherwise every leap year
 * drags the comparison window one day out of alignment, and the drift
 * compounds the further back the recap is generated (which it will be:
 * #130 requires generating every historical year at once, not just
 * forward from ship date). Any other window falls back to the equal-length
 * span immediately before it, which is the only sensible generic answer.
 *
 * This returns a window, not a promise that the window has data in it —
 * `hasPrior` in `toRecapStat` below is what decides whether a comparison is
 * shown at all.
 */
export function previousPeriod(period: RecapPeriod): RecapPeriod {
  if (isCalendarYear(period)) {
    return yearPeriod(Number(period.start.slice(0, 4)) - 1);
  }
  const length = periodLengthDays(period);
  const end = addDays(period.start, -1);
  const start = addDays(period.start, -length);
  return { start, end, label: `${formatDate(start)} – ${formatDate(end)}` };
}

// --- Coverage: when a card has enough to say ------------------------------

/**
 * Minimum logged days before an *average, rate, or per-day comparison* is
 * treated as real.
 *
 * Two weeks is the smallest window where a mean isn't dominated by a
 * handful of days, and it's short enough that a genuinely sparse period
 * still gets a recap rather than a wall of empty cards. The number matters
 * because coverage in this app is genuinely uneven: the nine subs, the
 * dedicated entertainment tables, and the Spotify import all started
 * logging at different points in its history, so an early year can have a
 * full year of happiness scores and three days of anything else.
 *
 * The rule is deliberately *not* applied to totals — see below.
 */
export const MIN_DAYS_FOR_AVERAGE = 14;

/**
 * The threshold for a *total* ("47 movies", "12 new places").
 *
 * A count over a period is honest at any coverage — it's a fact about what
 * was logged, not an estimate of what was true — so the only thing that
 * makes a total card meaningless is having nothing at all to count. Cards
 * pass this constant explicitly rather than relying on a default, so which
 * rule a given card chose is visible at the call site instead of buried
 * here.
 */
export const MIN_DAYS_FOR_TOTAL = 1;

/**
 * A card's value plus its comparison, with both "not enough data" and "no
 * prior period" as first-class states rather than nulls each card
 * re-interprets its own way.
 *
 * `prior: null` on an `ok` stat is the earliest-year case #130 calls out
 * explicitly: nothing to compare against. It must render as its own copy,
 * never as a 0% delta and never as a silently-missing line — which is why
 * it's a distinct state here and not just a zero.
 */
export type RecapStat<T> =
  | { status: "ok"; value: T; prior: T | null }
  | { status: "insufficient"; loggedDays: number; requiredDays: number };

/**
 * Applies the coverage rule above to one card's numbers.
 *
 * The prior period gets held to the same threshold as the current one: a
 * comparison against a period that itself had four logged days is worse
 * than no comparison, because it looks authoritative. When the prior fails
 * coverage the stat stays `ok` and simply loses its comparison line.
 */
export function toRecapStat<T>({
  value,
  loggedDays,
  requiredDays,
  prior = null,
  priorLoggedDays = 0,
}: {
  value: T;
  loggedDays: number;
  requiredDays: number;
  prior?: T | null;
  priorLoggedDays?: number;
}): RecapStat<T> {
  if (loggedDays < requiredDays) {
    return { status: "insufficient", loggedDays, requiredDays };
  }
  const priorQualifies = prior !== null && priorLoggedDays >= requiredDays;
  return { status: "ok", value, prior: priorQualifies ? prior : null };
}

// --- What periods exist at all --------------------------------------------

/** Oldest and newest logged day, or null when nothing has been logged. */
export async function getRecapDataRange(): Promise<{ first: string; last: string } | null> {
  const db = getDb();
  const [row] = await db.select({ first: min(days.date), last: max(days.date) }).from(days);
  if (!row?.first || !row.last) return null;
  return { first: row.first, last: row.last };
}

export type RecapYearSummary = { year: number; loggedDays: number };

/**
 * Every year that has logged days, newest first, with its day count.
 *
 * Derived from the data itself rather than a hardcoded start year, because
 * #130's backfill requirement is that all historical years are generated at
 * once — a list anchored to ship date would silently hide most of them.
 * Years with a gap in the middle of the range still appear (with a zero
 * count) so the index reads as a continuous history rather than skipping
 * over a fallow year as if it never happened.
 *
 * The `days` table is the spine: every entertainment table's `date` column
 * is a foreign key into it, so anything logged has a day row. The one
 * exception is `musicListens`, which is keyed on a `playedAt` timestamp
 * from the Spotify import instead — a listen on a date with no day row
 * wouldn't extend this range. That's accepted rather than worked around:
 * an imported listen outside every logged day is an import artifact, not a
 * year worth generating a recap for.
 */
export async function listRecapYears(): Promise<RecapYearSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      year: sql<number>`extract(year from ${days.date})::int`,
      loggedDays: count(),
    })
    .from(days)
    .groupBy(sql`extract(year from ${days.date})`);

  if (rows.length === 0) return [];

  const counts = new Map(rows.map((r) => [r.year, r.loggedDays]));
  const years = [...counts.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);

  const summaries: RecapYearSummary[] = [];
  for (let year = last; year >= first; year -= 1) {
    summaries.push({ year, loggedDays: counts.get(year) ?? 0 });
  }
  return summaries;
}

/**
 * How many days in the period have a `days` row.
 *
 * "Logged" means the day was saved at least once — not that any particular
 * field on it was filled. That's the right denominator for "how much of
 * this period did you actually track", and it's what the coverage rule
 * above is expressed in. A card whose own field is sparser than the period
 * (subs on an early year, say) should count its own non-null column and
 * pass that instead, rather than inheriting this looser number.
 */
export async function countLoggedDays(period: RecapPeriod): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(days)
    .where(and(gte(days.date, period.start), lte(days.date, period.end)));
  return row?.value ?? 0;
}


// --- First appearances -----------------------------------------------------

/**
 * Keys whose *earliest* appearance anywhere in the supplied history falls
 * inside the period, in discovery order — with the date each was first
 * seen.
 *
 * Callers pass every appearance they know about, across all time, not just
 * the period's, because the whole question is whether anything earlier
 * exists. Feeding this only the period's own rows would report every key in
 * it as new.
 *
 * Lives in the foundation rather than in one domain module because three
 * sections now ask the identical question of different tables: new artists
 * and movie genres (#171), new people, places and countries (#172), and
 * first-time moments (#174). Its one non-obvious constraint is shared by
 * all of them — first appearance comes from the usage tables, never a
 * catalog's `createdAt`, which for migrated rows is import day and would
 * report a decade of discoveries as happening at once.
 */
export function firstSeenInPeriodWithDates(
  period: RecapPeriod,
  appearances: { key: string; date: string }[]
): { key: string; date: string }[] {
  const earliest = new Map<string, string>();
  for (const { key, date } of appearances) {
    const seen = earliest.get(key);
    if (seen === undefined || date < seen) earliest.set(key, date);
  }
  return [...earliest.entries()]
    .filter(([, date]) => date >= period.start && date <= period.end)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key, date]) => ({ key, date }));
}

/** `firstSeenInPeriodWithDates` when only the keys are wanted. */
export function firstSeenInPeriod(
  period: RecapPeriod,
  appearances: { key: string; date: string }[]
): string[] {
  return firstSeenInPeriodWithDates(period, appearances).map((entry) => entry.key);
}

/** Parses a `/recap/[year]` route segment, rejecting anything that isn't a
 * plausible four-digit year — the route is user-typeable, and a bad segment
 * should 404 rather than reach a query. */
export function parseYearSegment(segment: string): number | null {
  if (!/^\d{4}$/.test(segment)) return null;
  const year = Number(segment);
  return isValidDateString(`${year}-01-01`) ? year : null;
}
