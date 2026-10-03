import { and, between, count, isNotNull, max, min, or, sql } from "drizzle-orm";
import { days, movieWatches, movies } from "@/db/schema";
import { getDb } from "@/lib/db";
import { firstSeenInPeriodWithDates, type RecapPeriod } from "@/lib/recap";
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
  | "first-genre";

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
 * `happinessMagnitude`), so they aren't listed here.
 */
const MAGNITUDE = {
  firstCountry: 0.9,
  firstGenre: 0.4,
} as const;

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
};

/**
 * Loads `MomentInputs` covering every window in `windows` at once — one
 * read whether that's a single recap period or a decade of "on this day"
 * windows.
 */
export async function loadMomentInputs(windows: RecapPeriod[]): Promise<MomentInputs> {
  const db = getDb();
  // `sql.raw` because these are module constants, not input — and inlining
  // them keeps `percentile_cont`'s argument a literal double rather than a
  // parameter Postgres has to infer a type for.
  const pct = (fraction: number) =>
    sql<number>`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${days.happiness})`.mapWith(Number);

  const [baselineRows, scoreRows, place1Rows, place2Rows, genreResult] = await Promise.all([
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
  const { countryByPlaceId } = await resolvePlaceRoots([...firstByPlace.keys()]);

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

  const genreRows = (Array.isArray(genreResult) ? genreResult : (genreResult as { rows: unknown[] }).rows) as {
    key: string;
    date: string;
  }[];

  return {
    baseline,
    scores: scoreRows.map((r) => ({ date: r.date, happiness: r.happiness as number })),
    firstCountries,
    firstGenres: genreRows,
  };
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
  ];

  return moments.sort(
    (a, b) => b.magnitude - a.magnitude || a.date.localeCompare(b.date)
  );
}

/** Every moment for the period, ranked. */
export async function getRecapMoments(period: RecapPeriod): Promise<RecapMoment[]> {
  return buildRecapMoments(await loadMomentInputs([period]), period);
}
