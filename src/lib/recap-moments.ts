import { and, between, count, eq, inArray, isNotNull, max, min, or, sql } from "drizzle-orm";
import { days, metros, movieWatches, movies, people, places } from "@/db/schema";
import { getDb } from "@/lib/db";
import { firstSeenInPeriodWithDates, type RecapPeriod } from "@/lib/recap";
import {
  buildRecapLifeEvents,
  loadLifeEventSources,
  type LifeEventSources,
  type RecapLifeEvent,
} from "@/lib/recap-life-events";
import { resolvePlaceRoots } from "@/lib/recap-people-places";

// The recap's data-derived moments engine (issue #174, epic #130).
//
// #130 flagged the thresholds here as a real open design question rather
// than an implementation detail, and #174 made "write the rules down and
// have them reviewed before building" its first acceptance criterion. The
// full rule set was posted and agreed on #174 before any of this existed;
// what follows is that spec, with the reasoning kept next to the code so it
// can be argued with later.
//
// Everything is automatic. Manual flagging was ruled out deliberately —
// same "you have to remember to do it" failure mode #47 avoided for infra.

/** How extreme a moment is, on a shared 0-1 scale. See `MAGNITUDE` below
 * for why cross-kind comparison is an editorial choice, not a measurement. */
export type RecapMomentKind =
  | "happiness-spike"
  | "happiness-dip"
  | "first-country"
  | "first-genre"
  | "first-city"
  | "first-person"
  | "life-start";

export type RecapMoment = {
  date: string;
  kind: RecapMomentKind;
  /** Structured, never freeform text — #130 excludes `journal` and
   * `happinessReason` from every card, and a moment headline is the most
   * tempting place to break that. */
  headline: string;
  detail: string | null;
  magnitude: number;
};

/**
 * Percentile cutoffs for a day to count as a spike or a dip, measured
 * against the **all-time** distribution of happiness scores.
 *
 * Percentiles rather than the z-score the issue floated: the real
 * distribution rules z-scores out. Scores sit tightly against a hard
 * ceiling of 100 (a typical year averages ~88 with a best of 99), so the
 * upper tail is compressed and the lower tail is long. A z cutoff loose
 * enough to catch a sensible number of dips catches almost no spikes,
 * because there is not room above the mean for 2σ to exist. Percentiles
 * don't care about the shape and treat both tails alike.
 *
 * All-time rather than the period's own distribution (agreed on #174): a
 * bad year scored against itself promotes its own mediocre days to
 * "spikes", which would generate the most celebration in the worst years.
 * Against all-time, a moment means "a genuinely great day by your
 * standards". The cost is that a uniformly good year may produce few
 * moments — correct, not a gap.
 */
const SPIKE_PERCENTILE = 0.99;
const DIP_PERCENTILE = 0.01;

/**
 * Below this many all-time logged scores, no happiness moments are emitted
 * at all — a 99th percentile over thirty days is just "the best of thirty
 * days" wearing a statistical costume.
 */
const MIN_SCORES_FOR_PERCENTILES = 100;

/**
 * Where each kind sits when moments of different kinds are ranked against
 * each other.
 *
 * **This is the honest part to flag: a percentile distance and "first time
 * in Japan" are not commensurable.** Cross-kind ordering is a stated
 * editorial preference, not a measurement, and writing it as a number makes
 * it reviewable and tunable instead of hiding it inside a sort. A first
 * country outranks all but the most extreme days; a first genre sits below
 * a strong day.
 *
 * Happiness moments compute their own magnitude from the data (see
 * `happinessMagnitude`), and so do first days with a person (see
 * `personMagnitude`), so neither is listed here.
 *
 * Added for "on this day" (#522), placed on the scale agreed there: a life
 * start (a job, a home, a relationship) sits above a first country — it's
 * the most significant thing a date can be the anniversary of — and a
 * first city sits between a first country and a first genre.
 */
const MAGNITUDE = {
  lifeStart: 0.95,
  firstCountry: 0.9,
  firstCity: 0.7,
  firstGenre: 0.4,
} as const;

/**
 * A person's first day only counts once they've been logged on at least
 * this many days in total.
 *
 * Without a floor, every acquaintance logged once becomes a "first day
 * with" moment, and a date fills up with people who never mattered. Ten
 * days is "came back often enough to be part of your life" without
 * needing years of history to qualify.
 */
export const MIN_DAYS_FOR_PERSON = 10;

/**
 * Where someone just over `MIN_DAYS_FOR_PERSON` lands. Lowered from 0.5 to
 * 0.25 on #522: a person seen a dozen times shouldn't outrank a first film
 * genre (0.4), so the bottom of the person range now sits below every
 * fixed-score kind and only people logged often climb past them.
 */
export const PERSON_MAGNITUDE_FLOOR = 0.25;

/**
 * How significant a first day with someone is, from how many days you've
 * logged with them overall: log-scaled between `PERSON_MAGNITUDE_FLOOR`
 * and the most-logged person you have (1.0, level with your best-ever day).
 *
 * Log rather than linear because day counts are wildly skewed — a partner
 * might have 1,500 days to a good friend's 60. Linear would squash
 * everyone but the top one or two against the floor; log keeps a friend of
 * a few hundred days well above someone met a dozen times, while the
 * people with tons of days still lead (asked for on #522). On this scale a
 * person outranks a first country about 87% of the way, in log terms, to
 * your most-logged person, and a first city (0.7) about 60% of the way.
 */
export function personMagnitude(totalDays: number, maxTotalDays: number): number {
  const floor = PERSON_MAGNITUDE_FLOOR;
  if (maxTotalDays <= MIN_DAYS_FOR_PERSON) return floor;
  const t = Math.log(totalDays / MIN_DAYS_FOR_PERSON) / Math.log(maxTotalDays / MIN_DAYS_FOR_PERSON);
  return floor + (1 - floor) * Math.min(1, Math.max(0, t));
}

/**
 * Days after a signal's logging began during which its "firsts" are
 * ignored.
 *
 * When people or places start being logged, everyone and everywhere
 * already in your life shows up for the "first" time within a few weeks —
 * the first day with a parent you've known all your life is just the day
 * you started filling in that field. Ninety days lets the regulars appear
 * before anything counts as new. It's applied to the person and city
 * signals added for #522; the first-country signal predates it and still
 * reports the home country on the first logged day.
 */
export const WARM_UP_DAYS = 90;

/** Linear interpolation between the two nearest ranks — the same definition
 * `PERCENTILE_CONT` uses, so this agrees with what a SQL implementation
 * would say if this ever moves into the database. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * How far a day sits from the all-time median, scaled by how far the most
 * extreme day in that direction sits from it. Naturally lands in 0-1, and
 * is symmetric: the worst day ever and the best day ever both score 1.
 */
function happinessMagnitude(score: number, baseline: HappinessBaseline): number {
  const { median } = baseline;
  const extreme = score >= median ? baseline.max : baseline.min;
  const span = Math.abs(extreme - median);
  if (span === 0) return 0;
  return Math.min(1, Math.abs(score - median) / span);
}

export type HappinessScore = { date: string; happiness: number };

/**
 * Everything the happiness rule needs from the all-time distribution: its
 * size, the two cutoffs, and the anchors magnitude is scaled against.
 *
 * A summary rather than the scores themselves so the distribution can be
 * computed in SQL (`loadMomentInputs`) instead of every score being shipped
 * to the server just to be sorted — Home asks this question on every visit
 * for "on this day" (#522). `happinessBaseline` is the same summary in JS;
 * the two agree because `percentile` is `PERCENTILE_CONT`'s definition.
 */
export type HappinessBaseline = {
  count: number;
  spikeAt: number;
  dipAt: number;
  median: number;
  min: number;
  max: number;
};

/** The baseline from raw scores, or null when there are none. */
export function happinessBaseline(scores: number[]): HappinessBaseline | null {
  if (scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  return {
    count: sorted.length,
    spikeAt: percentile(sorted, SPIKE_PERCENTILE),
    dipAt: percentile(sorted, DIP_PERCENTILE),
    median: percentile(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Happiness moments for the period, from the all-time distribution.
 *
 * Exported and pure: the percentile rule, the collapsing of adjacent days
 * and the magnitude scale are the whole substance of this signal, and none
 * of them need a database.
 *
 * **Adjacent qualifying days collapse into one moment, keeping the most
 * extreme.** A great weekend is one thing that happened, not three
 * near-identical entries crowding out everything else in the list.
 */
export function happinessMoments(allTime: HappinessScore[], period: RecapPeriod): RecapMoment[] {
  return happinessMomentsFromBaseline(
    happinessBaseline(allTime.map((row) => row.happiness)),
    allTime,
    period
  );
}

/**
 * `happinessMoments` against a precomputed baseline. `scores` only has to
 * cover the period — rows outside it are ignored, and the all-time
 * comparison lives entirely in `baseline`.
 */
export function happinessMomentsFromBaseline(
  baseline: HappinessBaseline | null,
  scores: HappinessScore[],
  period: RecapPeriod
): RecapMoment[] {
  if (baseline === null || baseline.count < MIN_SCORES_FOR_PERCENTILES) return [];
  const { spikeAt, dipAt } = baseline;

  const inPeriod = scores
    .filter((row) => row.date >= period.start && row.date <= period.end)
    .sort((a, b) => a.date.localeCompare(b.date));

  const moments: RecapMoment[] = [];
  let run: { kind: "happiness-spike" | "happiness-dip"; best: HappinessScore } | null = null;

  const flush = () => {
    if (!run) return;
    const { kind, best } = run;
    moments.push({
      date: best.date,
      kind,
      headline: kind === "happiness-spike" ? "One of your best days" : "One of your hardest days",
      detail: `${best.happiness} / 100`,
      magnitude: happinessMagnitude(best.happiness, baseline),
    });
    run = null;
  };

  let previousDate: string | null = null;
  for (const row of inPeriod) {
    const kind =
      row.happiness >= spikeAt
        ? ("happiness-spike" as const)
        : row.happiness <= dipAt
          ? ("happiness-dip" as const)
          : null;

    if (kind === null) {
      flush();
      previousDate = row.date;
      continue;
    }

    // Only calendar-adjacent days of the *same* kind continue a run. A dip
    // the day after a spike is two moments, not one — that contrast is
    // arguably the more interesting thing that happened.
    const consecutive = previousDate !== null && daysBetween(previousDate, row.date) === 1;
    if (run && run.kind === kind && consecutive) {
      const better =
        kind === "happiness-spike"
          ? row.happiness > run.best.happiness
          : row.happiness < run.best.happiness;
      if (better) run.best = row;
    } else {
      flush();
      run = { kind, best: row };
    }
    previousDate = row.date;
  }
  flush();

  return moments;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * What the moments rules read, shaped as narrowly as each rule allows.
 *
 * None of the three signals needs the full history row by row: happiness
 * needs the all-time *distribution* (`baseline`) plus the scores inside the
 * window, and a first time only needs the *earliest* appearance of each
 * country or genre — `firstSeenInPeriodWithDates` keeps the minimum per key
 * anyway, so pre-minimising in SQL gives it the same answer from a few
 * hundred rows instead of every logged day. That's what lets Home ask "on
 * this day" (#522) every visit without a whole-history pass per request.
 */
export type MomentInputs = {
  baseline: HappinessBaseline | null;
  /** Scores inside the requested windows only. */
  scores: HappinessScore[];
  /** Earliest appearance of each country, all time. */
  firstCountries: { key: string; date: string }[];
  /** Earliest watch of each film genre, all time. */
  firstGenres: { key: string; date: string }[];
  /** Earliest day in each metro — only those inside the windows. */
  firstCities: { key: string; date: string }[];
  /** The first day any place was logged; city firsts within
   * `WARM_UP_DAYS` of it are ignored. */
  placesLoggedFrom: string | null;
  /** First day with each person, with their all-time day count — only
   * those inside the windows. */
  firstPeople: { name: string; date: string; totalDays: number }[];
  /** The most days logged with any one person — the top of the
   * `personMagnitude` scale, so it's all-time, not window-filtered. */
  maxPersonDays: number;
  /** The first day any person was logged (see `WARM_UP_DAYS`). */
  peopleLoggedFrom: string | null;
  /** Profile lists for life starts, or null when not asked for. */
  lifeSources: LifeEventSources | null;
};

/**
 * Loads `MomentInputs` covering every window in `windows` at once — one
 * read whether that's a single recap period or a decade of "on this day"
 * windows.
 */
export async function loadMomentInputs(
  windows: RecapPeriod[],
  { lifeStarts = false }: { lifeStarts?: boolean } = {}
): Promise<MomentInputs> {
  const db = getDb();
  const inWindows = (date: string) => windows.some((w) => date >= w.start && date <= w.end);
  // `sql.raw` because these are module constants, not input — and inlining
  // them keeps `percentile_cont`'s argument a literal double rather than a
  // parameter Postgres has to infer a type for.
  const pct = (fraction: number) =>
    sql<number>`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${days.happiness})`.mapWith(Number);

  const [baselineRows, scoreRows, place1Rows, place2Rows, genreResult, personResult, lifeSources] = await Promise.all([
    db
      .select({
        count: count(),
        spikeAt: pct(SPIKE_PERCENTILE),
        dipAt: pct(DIP_PERCENTILE),
        median: pct(0.5),
        min: min(days.happiness),
        max: max(days.happiness),
      })
      .from(days)
      .where(isNotNull(days.happiness)),
    windows.length === 0
      ? []
      : db
          .select({ date: days.date, happiness: days.happiness })
          .from(days)
          .where(
            and(
              isNotNull(days.happiness),
              or(...windows.map((w) => between(days.date, w.start, w.end)))
            )
          ),
    // The two place slots separately rather than a union, so both stay
    // typed builder queries; merged to one earliest date per place below.
    db
      .select({ placeId: days.place1Id, first: min(days.date) })
      .from(days)
      .where(isNotNull(days.place1Id))
      .groupBy(days.place1Id),
    db
      .select({ placeId: days.place2Id, first: min(days.date) })
      .from(days)
      .where(isNotNull(days.place2Id))
      .groupBy(days.place2Id),
    db.execute(sql`
      select g.genre as key, to_char(min(${movieWatches.date}), 'YYYY-MM-DD') as date
      from ${movieWatches}
      inner join ${movies} on ${movies.id} = ${movieWatches.movieId}
      cross join lateral unnest(${movies.genres}) as g(genre)
      group by g.genre
    `),
    // Positive slots only, the same choice the recap's people section makes
    // (a negative slot means the opposite of "who you spent time with").
    db.execute(sql`
      select p.person_id as id, to_char(min(${days.date}), 'YYYY-MM-DD') as first,
             count(distinct ${days.date})::int as "totalDays"
      from ${days}
      cross join lateral unnest(array[
        ${days.positivePerson1Id}, ${days.positivePerson2Id}, ${days.positivePerson3Id},
        ${days.positivePerson4Id}, ${days.positivePerson5Id}, ${days.positivePerson6Id},
        ${days.positivePerson7Id}
      ]) as p(person_id)
      where p.person_id is not null
      group by p.person_id
    `),
    lifeStarts ? loadLifeEventSources() : null,
  ]);

  const firstByPlace = new Map<number, string>();
  for (const { placeId, first } of [...place1Rows, ...place2Rows]) {
    if (placeId === null || first === null) continue;
    const seen = firstByPlace.get(placeId);
    if (seen === undefined || first < seen) firstByPlace.set(placeId, first);
  }
  // Country resolution is shared with the people & places section, so the
  // moments list and the countries-visited count can never disagree about
  // what counts as a country (see `loadRecapPeoplePlacesInput`).
  const [{ countryByPlaceId }, metroByPlaceId] = await Promise.all([
    resolvePlaceRoots([...firstByPlace.keys()]),
    // Every logged place, not just those first seen in a window: a city's
    // first day is its earliest place's, and a new café in a city you'd
    // already been to must not read as the first time there.
    resolvePlaceMetros([...firstByPlace.keys()]),
  ]);

  // Countries only — not places or artists. Those were tried and cut: the
  // real data produces 203 first-time places in a single year and 456
  // first-time artists in another, which would bury every other signal in
  // the list. Both are already reported as counts by their own sections.
  // A first country is rare and unambiguous.
  const firstByCountry = new Map<string, string>();
  for (const [placeId, date] of firstByPlace) {
    const country = countryByPlaceId.get(placeId);
    if (!country) continue;
    const seen = firstByCountry.get(country);
    if (seen === undefined || date < seen) firstByCountry.set(country, date);
  }
  const firstCountries = [...firstByCountry].map(([key, date]) => ({ key, date }));

  const [row] = baselineRows;
  const baseline: HappinessBaseline | null =
    row && row.count > 0 && row.min !== null && row.max !== null
      ? { count: row.count, spikeAt: row.spikeAt, dipAt: row.dipAt, median: row.median, min: row.min, max: row.max }
      : null;

  const genreRows = rowsOf<{ key: string; date: string }>(genreResult);

  const firstByMetro = new Map<string, string>();
  for (const [placeId, metro] of metroByPlaceId) {
    const date = firstByPlace.get(placeId) as string;
    const seen = firstByMetro.get(metro);
    if (seen === undefined || date < seen) firstByMetro.set(metro, date);
  }
  const placeDates = [...firstByPlace.values()].sort();

  const personRows = rowsOf<{ id: number; first: string; totalDays: number }>(personResult);
  const firstDates = personRows.map((r) => r.first).sort();
  const wanted = personRows.filter((r) => r.totalDays >= MIN_DAYS_FOR_PERSON && inWindows(r.first));
  const nameRows = wanted.length
    ? await db
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(inArray(people.id, wanted.map((r) => r.id)))
    : [];
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  return {
    baseline,
    scores: scoreRows.map((r) => ({ date: r.date, happiness: r.happiness as number })),
    firstCountries,
    firstGenres: genreRows,
    firstCities: [...firstByMetro]
      .filter(([, date]) => inWindows(date))
      .map(([key, date]) => ({ key, date })),
    placesLoggedFrom: placeDates[0] ?? null,
    firstPeople: wanted.flatMap((r) => {
      const name = nameById.get(r.id);
      return name ? [{ name, date: r.first, totalDays: r.totalDays }] : [];
    }),
    maxPersonDays: Math.max(0, ...personRows.map((r) => r.totalDays)),
    peopleLoggedFrom: firstDates[0] ?? null,
    lifeSources,
  };
}

/**
 * Each place's metro name, via its nearest ancestor-or-self that has one.
 *
 * Metros are set at the municipality tier, so a café inherits its city's
 * from an ancestor — the same walk `location-centre.ts` does. Places with no
 * metro anywhere up their chain (rural places, most of the world outside
 * the cities someone bothered to group) are simply absent.
 */
async function resolvePlaceMetros(placeIds: number[]): Promise<Map<number, string>> {
  const db = getDb();
  if (placeIds.length === 0) return new Map();
  const leafRows = await db
    .select({ id: places.id, idPath: places.idPath })
    .from(places)
    .where(inArray(places.id, placeIds));
  const chainOf = (row: { id: number; idPath: string | null }) =>
    (row.idPath ?? `${row.id}/`).split("/").filter(Boolean).map(Number).reverse();
  const chainIds = [...new Set(leafRows.flatMap(chainOf))];
  const chainRows = await db
    .select({ id: places.id, metroId: places.metroId, metroName: metros.name })
    .from(places)
    .leftJoin(metros, eq(metros.id, places.metroId))
    .where(inArray(places.id, chainIds));
  const metroOf = new Map(chainRows.map((r) => [r.id, r.metroName]));

  const result = new Map<number, string>();
  for (const row of leafRows) {
    const metro = chainOf(row).map((id) => metroOf.get(id)).find((name) => name);
    if (metro) result.set(row.id, metro);
  }
  return result;
}

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as T[];
}

/**
 * Every moment for the period, ranked — the pure half of
 * `getRecapMoments`. `inputs` may cover more than `period` (on this day
 * loads every year's window at once); anything outside it is ignored.
 *
 * Sorted by magnitude descending, ties broken by date ascending so the
 * order is stable between requests.
 */
export function buildRecapMoments(inputs: MomentInputs, period: RecapPeriod): RecapMoment[] {
  const countryFirstDates = new Set(
    firstSeenInPeriodWithDates(period, inputs.firstCountries).map((entry) => entry.date)
  );
  const moments: RecapMoment[] = [
    ...happinessMomentsFromBaseline(inputs.baseline, inputs.scores, period),
    ...firstSeenInPeriodWithDates(period, inputs.firstCountries).map((entry) => ({
      date: entry.date,
      kind: "first-country" as const,
      headline: `First time in ${entry.key}`,
      detail: null,
      magnitude: MAGNITUDE.firstCountry,
    })),
    ...firstSeenInPeriodWithDates(period, inputs.firstGenres).map((entry) => ({
      date: entry.date,
      kind: "first-genre" as const,
      headline: `First ${entry.key.toLowerCase()} film`,
      detail: null,
      magnitude: MAGNITUDE.firstGenre,
    })),
    ...firstCityMoments(inputs, period, countryFirstDates),
    ...firstPersonMoments(inputs, period),
    ...lifeStartMoments(inputs, period),
  ];

  return moments.sort(
    (a, b) => b.magnitude - a.magnitude || a.date.localeCompare(b.date)
  );
}

function inPeriod(date: string, period: RecapPeriod): boolean {
  return date >= period.start && date <= period.end;
}

/** `true` once `date` is past the warm-up after `from` (see `WARM_UP_DAYS`). */
function pastWarmUp(date: string, from: string | null): boolean {
  return from !== null && daysBetween(from, date) >= WARM_UP_DAYS;
}

/**
 * First day in a city. Dropped when a first country lands on the same day:
 * landing in Tokyo for the first time is "first time in Japan", and a
 * second line saying Tokyo too is the same event twice.
 */
function firstCityMoments(
  inputs: MomentInputs,
  period: RecapPeriod,
  countryFirstDates: Set<string>
): RecapMoment[] {
  return firstSeenInPeriodWithDates(period, inputs.firstCities)
    .filter((entry) => pastWarmUp(entry.date, inputs.placesLoggedFrom) && !countryFirstDates.has(entry.date))
    .map((entry) => ({
      date: entry.date,
      kind: "first-city" as const,
      headline: `First time in ${entry.key}`,
      detail: null,
      magnitude: MAGNITUDE.firstCity,
    }));
}

/** First day with someone you went on to log at least `MIN_DAYS_FOR_PERSON`
 * days with, scored by how many (see `personMagnitude`). Filtered here, not
 * through `firstSeenInPeriodWithDates`, because the list is already one
 * earliest date per person — and keying by name would merge two people who
 * share one. */
function firstPersonMoments(inputs: MomentInputs, period: RecapPeriod): RecapMoment[] {
  return inputs.firstPeople
    .filter(
      (person) =>
        person.totalDays >= MIN_DAYS_FOR_PERSON &&
        inPeriod(person.date, period) &&
        pastWarmUp(person.date, inputs.peopleLoggedFrom)
    )
    .map((person) => ({
      date: person.date,
      kind: "first-person" as const,
      headline: `First day with ${person.name}`,
      detail: `${person.totalDays.toLocaleString()} days together since`,
      magnitude: personMagnitude(person.totalDays, inputs.maxPersonDays),
    }));
}

/** Phrased per kind, matching the recap's life-events card verbs. */
const LIFE_START_HEADLINE: Record<RecapLifeEvent["kind"], (title: string) => string> = {
  occupation: (title) => `Started at ${title}`,
  education: (title) => `Enrolled at ${title}`,
  role: (title) => `Started as ${title}`,
  residence: (title) => `Moved into ${title}`,
  relationship: (title) => `Began: ${title}`,
};

/** A job, school, role, home or relationship that began in the period.
 * Starts only — an ending (leaving a job, a breakup) isn't something to
 * resurface unprompted, the same reasoning that keeps dips off Home. */
function lifeStartMoments(inputs: MomentInputs, period: RecapPeriod): RecapMoment[] {
  if (inputs.lifeSources === null) return [];
  return buildRecapLifeEvents(inputs.lifeSources, period)
    .filter((event) => event.framing === "started" || event.framing === "started-and-ended")
    .filter((event) => inPeriod(event.start, period))
    .map((event) => ({
      date: event.start,
      kind: "life-start" as const,
      headline: LIFE_START_HEADLINE[event.kind](event.title),
      detail: event.detail,
      magnitude: MAGNITUDE.lifeStart,
    }));
}

/**
 * Every moment for the period, ranked.
 *
 * Life starts aren't loaded here: the recap already has a Life events
 * section saying the same thing, and in a chapter recap (#519) the
 * chapter's own start would top its moments list — the self-description
 * `lifeEntryKey` exists to prevent. They're for "on this day" only.
 */
export async function getRecapMoments(period: RecapPeriod): Promise<RecapMoment[]> {
  return buildRecapMoments(await loadMomentInputs([period]), period);
}
