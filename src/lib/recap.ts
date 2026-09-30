import { and, count, gte, lte, max, min, sql } from "drizzle-orm";
import { days } from "@/db/schema";
import { addDays, isValidDateString, parseDate, todayDateString } from "@/lib/date";
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

/** The calendar year as a period. */
export function yearPeriod(year: number): RecapPeriod {
  return { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) };
}

/**
 * One calendar month as a period (#176), `month` 1-12.
 *
 * The monthly recap's whole claim on the foundation is this constructor
 * plus the month branch in `previousPeriod` — every fetcher below and in
 * the domain modules already took a `RecapPeriod`, so none of their
 * signatures changed to support it. That was #130's test of whether the
 * annual build stayed period-agnostic.
 *
 * The label spells the month out ("March 2025") because it's interpolated
 * into prose all over the report ("Same as February 2025", "Who you spent
 * March 2025 with"), where "Mar 2025" reads like an axis tick.
 */
export function monthPeriod(year: number, month: number): RecapPeriod {
  const mm = String(month).padStart(2, "0");
  // Day 0 of the following month is the last day of this one — lets the
  // runtime own month lengths and leap Februaries rather than a table here.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = `${year}-${mm}-01`;
  return {
    start,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    label: formatDate(start, "monthNameYear"),
  };
}

/** Which whole calendar unit a period is, or null for an arbitrary window.
 *
 * Derived from the bounds rather than carried as a field on `RecapPeriod`,
 * so adding the month cadence didn't widen the type every fetcher takes.
 * Copy that needs to say "year" or "month" asks this instead. */
export function periodUnit(period: RecapPeriod): "year" | "month" | null {
  const year = Number(period.start.slice(0, 4));
  const month = Number(period.start.slice(5, 7));
  const asYear = yearPeriod(year);
  if (period.start === asYear.start && period.end === asYear.end) return "year";
  const asMonth = monthPeriod(year, month);
  if (period.start === asMonth.start && period.end === asMonth.end) return "month";
  return null;
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
  const unit = periodUnit(period);
  const year = Number(period.start.slice(0, 4));
  if (unit === "year") return yearPeriod(year - 1);
  // Same reasoning one level down, and more acute: months run 28-31 days,
  // so an equal-length shift from March would compare against a window
  // starting February 1 in a leap year and January 29 otherwise. A month
  // compares against the whole calendar month before it — month over
  // month, which is the comparison #176 asked for. (Same-month-last-year
  // is the other candidate it floated; it's a different window, not a
  // different rule, and can be added beside this without changing it.)
  if (unit === "month") {
    const month = Number(period.start.slice(5, 7));
    return month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
  }
  const length = periodLengthDays(period);
  const end = addDays(period.start, -1);
  const start = addDays(period.start, -length);
  return { start, end, label: `${formatDate(start)} – ${formatDate(end)}` };
}

// --- Publishing: when a period's recap exists at all ------------------------

/**
 * Days after a period ends before its recap is published (#517).
 *
 * A recap is a reveal, so it shouldn't exist while its period is still
 * running — and it shouldn't appear the instant the period ends either,
 * because this diary is backfilled: a recap generated at midnight would
 * read days that haven't been logged yet, and the moments engine would
 * score the period against a thinner history than it ends up with. The
 * grace window is the time to fill those days in. Three days covers a
 * long weekend away from the app.
 *
 * It also absorbs the timezone skew described on `isPeriodPublished`, which
 * is why it isn't smaller.
 */
export const PUBLISH_GRACE_DAYS = 3;

/** The first date on which a period is published: the day after the grace
 * window closes. Also what the "ready on …" state shows. */
export function periodPublishDate(period: RecapPeriod): string {
  return addDays(period.end, PUBLISH_GRACE_DAYS + 1);
}

/**
 * Whether a period's recap is out yet, given today's calendar date.
 *
 * Takes `today` rather than reading the clock so the boundary days are
 * testable and so every caller on one request agrees about what day it is.
 * It works on any `RecapPeriod` — a year, a month, or a custom window —
 * because the rule is about the period's end, not its unit. A year is
 * therefore published on its own clock, independent of its months: March's
 * recap can be live while 2026's isn't.
 *
 * **Timezone.** The app has no fixed timezone (`src/lib/date.ts`: a day is
 * whatever date you say you're journaling for), and the pages that call
 * this render on the server, where "today" is the server's local date —
 * UTC on Vercel. That can disagree with the owner's own calendar by up to
 * a day in either direction. That's acceptable *because* of the grace
 * window: a recap flipping to published a few hours early or late relative
 * to local midnight is invisible next to a three-day wait. Don't shrink
 * `PUBLISH_GRACE_DAYS` to zero without replacing this with an explicit
 * timezone.
 */
export function isPeriodPublished(period: RecapPeriod, today: string): boolean {
  return today >= periodPublishDate(period);
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

export type RecapYearSummary = {
  year: number;
  loggedDays: number;
  /** Whether the year's own recap is out. False for a year listed only
   * because some of its months are (#517) — its page then shows "ready on
   * …" above the month nav. */
  published: boolean;
};

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
 * Only years with something *published* are listed (#517,
 * `isPeriodPublished`): the current year is listed once its first month is
 * out, marked `published: false` until the year itself is. The list is
 * still derived from the data, just filtered.
 *
 * The `days` table is the spine: every entertainment table's `date` column
 * is a foreign key into it, so anything logged has a day row. The one
 * exception is `musicListens`, which is keyed on a `playedAt` timestamp
 * from the Spotify import instead — a listen on a date with no day row
 * wouldn't extend this range. That's accepted rather than worked around:
 * an imported listen outside every logged day is an import artifact, not a
 * year worth generating a recap for.
 */
export async function listRecapYears(today: string = todayDateString()): Promise<RecapYearSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      year: sql<number>`extract(year from ${days.date})::int`,
      month: sql<number>`extract(month from ${days.date})::int`,
      loggedDays: count(),
    })
    .from(days)
    .groupBy(sql`extract(year from ${days.date})`, sql`extract(month from ${days.date})`);

  const yearCounts = new Map<number, number>();
  const monthCounts = new Map<string, number>();
  for (const { year, month, loggedDays } of rows) {
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + loggedDays);
    monthCounts.set(`${year}-${String(month).padStart(2, "0")}`, loggedDays);
  }
  return summarizeYears(yearCounts, today, monthCounts);
}

/** The pure half of `listRecapYears`: the continuous first-to-last run of
 * years, newest first (#517).
 *
 * A year is listed when its own recap is published, *or* when any of its
 * months with logged days is — otherwise the in-progress year vanishes from
 * the index and its finished months (January–August, say) become
 * unreachable except by typing a URL. Such a year is listed as
 * `published: false` and links to its page, which says when it's ready and
 * carries the month nav. A fallow year in the middle is in the past, so it
 * stays. */
export function summarizeYears(
  counts: Map<number, number>,
  today: string,
  monthCounts: Map<string, number> = new Map()
): RecapYearSummary[] {
  if (counts.size === 0) return [];
  const years = [...counts.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);

  const hasPublishedMonth = (year: number) => {
    for (const [key, loggedDays] of monthCounts) {
      if (loggedDays <= 0 || !key.startsWith(`${year}-`)) continue;
      if (isPeriodPublished(monthPeriod(year, Number(key.slice(5, 7))), today)) return true;
    }
    return false;
  };

  const summaries: RecapYearSummary[] = [];
  for (let year = last; year >= first; year -= 1) {
    const published = isPeriodPublished(yearPeriod(year), today);
    if (!published && !hasPublishedMonth(year)) continue;
    summaries.push({ year, loggedDays: counts.get(year) ?? 0, published });
  }
  return summaries;
}

export type RecapMonthSummary = { month: number; period: RecapPeriod; loggedDays: number };

/**
 * The months of one year that fall inside the logged history, oldest first,
 * each with its day count — the month index on a year's recap page (#176).
 *
 * The same derive-from-the-data rule `listRecapYears` follows, one level
 * down: months before the first logged day or after the last aren't
 * listed at all (a January 2015 entry for a diary that began in June is a
 * dead link), while a fallow month *inside* the range still is, with a
 * zero, so the index reads as a continuous history.
 */
export async function listRecapMonths(
  year: number,
  today: string = todayDateString()
): Promise<RecapMonthSummary[]> {
  const db = getDb();
  const period = yearPeriod(year);
  const [range, rows] = await Promise.all([
    getRecapDataRange(),
    db
      .select({
        month: sql<number>`extract(month from ${days.date})::int`,
        loggedDays: count(),
      })
      .from(days)
      .where(and(gte(days.date, period.start), lte(days.date, period.end)))
      .groupBy(sql`extract(month from ${days.date})`),
  ]);
  if (range === null) return [];
  return monthsInRange(
    year,
    range,
    new Map(rows.map((row) => [row.month, row.loggedDays])),
    today
  );
}

/** The pure half of `listRecapMonths`: which of a year's twelve months
 * overlap the logged range and are published (#517), with their counts
 * (zero when absent). `today` is optional so the range logic can be
 * exercised on its own; omitted, nothing is filtered out. */
export function monthsInRange(
  year: number,
  range: { first: string; last: string },
  counts: Map<number, number>,
  today?: string
): RecapMonthSummary[] {
  const firstMonth = range.first.slice(0, 7);
  const lastMonth = range.last.slice(0, 7);
  const summaries: RecapMonthSummary[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const period = monthPeriod(year, month);
    const key = period.start.slice(0, 7);
    // "YYYY-MM" strings compare correctly as text, so no date math needed.
    if (key < firstMonth || key > lastMonth) continue;
    if (today !== undefined && !isPeriodPublished(period, today)) continue;
    summaries.push({ month, period, loggedDays: counts.get(month) ?? 0 });
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

/** Parses a `/recap/[year]/[month]` segment: exactly two digits, 01-12.
 * Two digits rather than a name so the URL sorts and stays stable
 * regardless of locale, and exactly two so `/recap/2025/3` 404s instead of
 * silently aliasing `/recap/2025/03`. */
export function parseMonthSegment(segment: string): number | null {
  if (!/^\d{2}$/.test(segment)) return null;
  const month = Number(segment);
  return month >= 1 && month <= 12 ? month : null;
}

/** The route segment for a month — the inverse of `parseMonthSegment`. */
export function monthSegment(month: number): string {
  return String(month).padStart(2, "0");
}
