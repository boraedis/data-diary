import { inArray } from "drizzle-orm";
import { days, people, places } from "@/db/schema";
import { addDays, isValidDateString } from "@/lib/date";
import { getDb } from "@/lib/db";
import { getRecapDataRange, isPeriodPublished, yearPeriod, type RecapPeriod } from "@/lib/recap";
import { buildRecapMoments, loadMomentInputs, type RecapMoment } from "@/lib/recap-moments";

// "On this day" (#522, epic #130 follow-up): resurfacing what happened on
// today's date in past years, built on the recap's moments engine (#174)
// rather than a second definition of "notable".
//
// Two surfaces, deliberately unequal (scope agreed on #522):
//
// - **Home** gets at most one line — the single strongest moment across
//   every past year — or nothing at all. A ten-year diary would otherwise
//   put a ten-row card on the page loaded every visit. Only real moments
//   qualify there; no structured-fact fallback, and no happiness dips (Home
//   shouldn't open on "your hardest day, four years ago").
// - **`/on-this-day`** is the full view: every past year, its strongest
//   moment (dips included — the honest version lives here), plus the
//   date's structured facts so a quiet year still shows something.
//
// Structured only, everywhere: no `journal` or `happinessReason` text. That
// is the obvious thing this feature makes you want to add ("what did I
// write that day?"), and surfacing it is a separate, deliberate decision —
// the same line the rest of the recap holds.

// --- Month-day handling ---------------------------------------------------

/**
 * A leap year to do month-day arithmetic in, so Feb 29 is a real day to
 * step onto and off of. The year itself never reaches the UI or a query.
 */
const REFERENCE_LEAP_YEAR = 2000;

/** Parses a `?date=MM-DD` param — exactly two digits each, and a real day
 * in a leap year, so "02-29" is accepted and "02-30" is not. */
export function parseMonthDay(value: string): string | null {
  if (!/^\d{2}-\d{2}$/.test(value)) return null;
  return isValidDateString(`${REFERENCE_LEAP_YEAR}-${value}`) ? value : null;
}

/** "MM-DD" of a "YYYY-MM-DD" date. */
export function monthDayOf(date: string): string {
  return date.slice(5);
}

/** The month-day `delta` days away, wrapping across the year end — Dec 31
 * steps to Jan 1, and Feb 28 steps onto Feb 29 rather than over it. */
export function shiftMonthDay(monthDay: string, delta: number): string {
  return monthDayOf(addDays(`${REFERENCE_LEAP_YEAR}-${monthDay}`, delta));
}

/**
 * The date a past year stands in for `monthDay`.
 *
 * **Feb 29 falls back to Feb 28 in a non-leap year** — the last day of the
 * same month, so the year still answers "what was happening at the end of
 * February". March 1 was the other candidate and was passed over because it
 * moves the date into a different month.
 */
export function dateInYear(monthDay: string, year: number): string {
  const date = `${year}-${monthDay}`;
  return isValidDateString(date) ? date : `${year}-02-28`;
}

/**
 * The single day a year is asked about, as a `RecapPeriod` so the moments
 * engine takes it unchanged.
 *
 * **Exactly the same date, no window** (decided on #522 after a first cut
 * used ±3 days): "on this day" means this day. A moment from three days
 * earlier reads as a different anniversary, and the full page's facts are
 * already for the exact date, so the two halves of a year's card now agree
 * on which day they're about. The cost is that moments match less often —
 * see `pickHomeHighlight` for what Home does about that.
 */
export function dayPeriod(date: string): RecapPeriod {
  return { start: date, end: date, label: date };
}

// --- Selection ------------------------------------------------------------

/**
 * The order moments compete in, within a year and (on Home) across years:
 *
 * 1. **Magnitude**, descending — the engine's own cross-kind ranking
 *    (`MAGNITUDE` in recap-moments.ts), so "notable" means the same thing
 *    here as in the recap.
 * 2. **Newer first** — the tie-break, and the order the full page reads in
 *    anyway.
 */
export function compareCandidates(a: { moment: RecapMoment }, b: { moment: RecapMoment }): number {
  return b.moment.magnitude - a.moment.magnitude || b.moment.date.localeCompare(a.moment.date);
}

/** Kinds Home never leads with. The full page still shows them. */
const HOME_EXCLUDED_KINDS: ReadonlySet<RecapMoment["kind"]> = new Set(["happiness-dip"]);

/** One past year's candidates for a month-day: every moment in its window. */
export type YearCandidates = {
  year: number;
  /** The date this year stands in for the month-day (see `dateInYear`). */
  date: string;
  moments: RecapMoment[];
};

/** The strongest moment in a year's window, dips included — the full
 * page's pick. */
export function pickYearMoment(candidates: YearCandidates): RecapMoment | null {
  const [best] = candidates.moments.map((moment) => ({ moment })).sort(compareCandidates);
  return best?.moment ?? null;
}

/** Home's single highlight: the strongest non-dip moment across every past
 * year, or null — in which case Home renders nothing at all. */
export function pickHomeHighlight(
  years: YearCandidates[]
): { year: number; date: string; moment: RecapMoment } | null {
  const pool = years.flatMap(({ year, date, moments }) =>
    moments
      .filter((moment) => !HOME_EXCLUDED_KINDS.has(moment.kind))
      .map((moment) => ({ year, date, moment }))
  );
  return pool.sort(compareCandidates)[0] ?? null;
}

/** The past years a month-day is asked of: every year with logged data,
 * newest first, never the current one — "on this day" is about other
 * years, and this year's version of the date is either today or already in
 * Recent days. */
export function pastYears(range: { first: string; last: string }, today: string): number[] {
  const first = Number(range.first.slice(0, 4));
  const last = Math.min(Number(range.last.slice(0, 4)), Number(today.slice(0, 4)) - 1);
  const years: number[] = [];
  for (let year = last; year >= first; year -= 1) years.push(year);
  return years;
}

/** The year's recap if it's out (#517's publish gate), else null. */
export function recapHrefFor(year: number, today: string): string | null {
  return isPeriodPublished(yearPeriod(year), today) ? `/recap/${year}` : null;
}

// --- Loading --------------------------------------------------------------

/**
 * Every past year's moment candidates for a month-day, from a single
 * moments read covering all of their windows.
 *
 * This is the cost #522 asked to be checked: Home runs it on every visit.
 * It is one `loadMomentInputs` call — an aggregate for the happiness
 * distribution, the scores on ~10 single dates, and earliest-date
 * aggregates for places and genres — never a whole-year moments pass per
 * past year, and never every logged day shipped to the server.
 */
async function loadYearCandidates(monthDay: string, today: string): Promise<YearCandidates[]> {
  const range = await getRecapDataRange();
  if (range === null) return [];
  const years = pastYears(range, today);
  if (years.length === 0) return [];

  const dates = years.map((year) => dateInYear(monthDay, year));
  const windows = dates.map(dayPeriod);
  const inputs = await loadMomentInputs(windows);

  return years.map((year, i) => ({
    year,
    date: dates[i],
    moments: buildRecapMoments(inputs, windows[i]),
  }));
}

export type OnThisDayHighlight = {
  year: number;
  yearsAgo: number;
  moment: RecapMoment;
  /** The year's recap when published, otherwise the moment's own day. */
  href: string;
};

/** Home's one line, or null. */
export async function getOnThisDayHighlight(today: string): Promise<OnThisDayHighlight | null> {
  const picked = pickHomeHighlight(await loadYearCandidates(monthDayOf(today), today));
  if (picked === null) return null;
  return {
    year: picked.year,
    yearsAgo: Number(today.slice(0, 4)) - picked.year,
    moment: picked.moment,
    href: recapHrefFor(picked.year, today) ?? `/day/${picked.moment.date}`,
  };
}

/** The structured facts for one date — never free text. People are the
 * positive slots only, the same choice the recap's people section makes
 * (a negative slot means the opposite of "who you saw"). */
export type OnThisDayFacts = {
  happiness: number | null;
  places: string[];
  people: string[];
};

export type OnThisDayYear = {
  year: number;
  yearsAgo: number;
  date: string;
  moment: RecapMoment | null;
  /** Null when the date has no day row, or one with nothing structured to
   * show. */
  facts: OnThisDayFacts | null;
  recapHref: string | null;
};

/**
 * The full page: every past year with *something* for the month-day,
 * newest first. A year with neither a moment nor facts is left out rather
 * than drawn as an empty card; when every year is, the result is empty and
 * the page says so in one line.
 */
export async function getOnThisDay(monthDay: string, today: string): Promise<OnThisDayYear[]> {
  const candidates = await loadYearCandidates(monthDay, today);
  if (candidates.length === 0) return [];

  const facts = await loadFacts(candidates.map((c) => c.date));
  const todayYear = Number(today.slice(0, 4));

  return candidates.flatMap((c) => {
    const moment = pickYearMoment(c);
    const dayFacts = facts.get(c.date) ?? null;
    if (moment === null && dayFacts === null) return [];
    return [
      {
        year: c.year,
        yearsAgo: todayYear - c.year,
        date: c.date,
        moment,
        facts: dayFacts,
        recapHref: recapHrefFor(c.year, today),
      },
    ];
  });
}

/** Happiness, places and positive people for a handful of dates — one
 * narrow read of exactly those day rows, plus their names. */
async function loadFacts(dates: string[]): Promise<Map<string, OnThisDayFacts>> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      happiness: days.happiness,
      place1Id: days.place1Id,
      place2Id: days.place2Id,
      p1: days.positivePerson1Id,
      p2: days.positivePerson2Id,
      p3: days.positivePerson3Id,
      p4: days.positivePerson4Id,
      p5: days.positivePerson5Id,
      p6: days.positivePerson6Id,
      p7: days.positivePerson7Id,
    })
    .from(days)
    .where(inArray(days.date, dates));

  const shaped = rows.map((row) => ({
    date: row.date,
    happiness: row.happiness,
    // Slot order kept: the first place slot is where the day mostly was.
    placeIds: [...new Set([row.place1Id, row.place2Id].filter(isId))],
    personIds: [...new Set([row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7].filter(isId))],
  }));

  const placeIds = [...new Set(shaped.flatMap((r) => r.placeIds))];
  const personIds = [...new Set(shaped.flatMap((r) => r.personIds))];
  const [placeRows, personRows] = await Promise.all([
    placeIds.length
      ? db.select({ id: places.id, name: places.name }).from(places).where(inArray(places.id, placeIds))
      : [],
    personIds.length
      ? db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, personIds))
      : [],
  ]);
  const placeNames = new Map(placeRows.map((r) => [r.id, r.name]));
  const personNames = new Map(personRows.map((r) => [r.id, r.name]));

  const byDate = new Map<string, OnThisDayFacts>();
  for (const row of shaped) {
    const facts: OnThisDayFacts = {
      happiness: row.happiness,
      places: row.placeIds.flatMap((id) => placeNames.get(id) ?? []),
      people: row.personIds.flatMap((id) => personNames.get(id) ?? []),
    };
    if (facts.happiness === null && facts.places.length === 0 && facts.people.length === 0) continue;
    byDate.set(row.date, facts);
  }
  return byDate;
}

function isId(value: number | null): value is number {
  return value !== null;
}
