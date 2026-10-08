import { formatDate, formatDuration } from "@/lib/viz/format";
import { MIN_DAYS_FOR_AVERAGE } from "@/lib/recap";
import type { RecapBody } from "@/lib/recap-body";
import type { RecapEntertainment } from "@/lib/recap-entertainment";
import { GOOD_DAY_THRESHOLD, type RecapHealth } from "@/lib/recap-health";
import type { RecapLifeEvent } from "@/lib/recap-life-events";
import type { RecapMoment } from "@/lib/recap-moments";
import type { RecapPeoplePlaces } from "@/lib/recap-people-places";
import type { RecapSubs } from "@/lib/recap-subs";
import type { RecapScreenTime, RecapWork } from "@/lib/recap-work";

// Which cards a period's story is made of (issue #175, epic #130).
//
// Pure and non-visual on purpose, the same split `life-timeline.ts` has from
// `InteractiveTimeline` and `hierarchy.ts` from `InteractiveDonut`: deciding
// *which* cards a year earns is the part with rules worth testing, and it
// shouldn't need a DOM to exercise. The component under
// `components/recap/recap-story.tsx` only reveals what this returns.
//
// The one rule that shapes everything here is #175's: card selection is
// data-driven, never a fixed list. A year that predates subs logging, or a
// year with no travel, must produce a *shorter* story — not the same slots
// with "not enough data" in them. So every candidate below is conditional on
// its own data existing, and selection fills from what survived rather than
// from a template.
//
// Nothing here reads `journal` or `happinessReason`. That's #130's rule for
// every card in the epic, and a story headline is the most tempting place to
// break it — the closest this gets is `RecapMoment.headline`, which the
// moments engine builds from structured signals for exactly this reason.

/**
 * The four v1 domains #175 requires the story to cover, plus the opener.
 *
 * Subs fold into `health` and moments into `life` rather than being domains
 * of their own: five buckets is already the exact number of distinct slots
 * `categoricalColor` has (see `colorIndex` below), and splitting them out
 * would push two domains onto the same flattened grey.
 */
export type RecapStoryDomain = "overview" | "health" | "entertainment" | "people-places" | "life";

/**
 * The narrative running order — how the year gets told, not how cards get
 * picked. Selection (below) is free to drop any of these; what survives is
 * re-sorted back into this order so the story always opens on the overview
 * and closes on what the year changed.
 */
const DOMAIN_ORDER: RecapStoryDomain[] = [
  "overview",
  "health",
  "entertainment",
  "people-places",
  "life",
];

/**
 * Each domain's fixed palette slot, assigned by *domain* rather than by card
 * position.
 *
 * `categoricalColor` has five real slots before every further index flattens
 * to the same muted grey (AGENTS.md), and a story can run to eight cards —
 * so colouring by position would hand cards 6-8 an identical grey. Keying on
 * the domain instead fits the palette exactly, never cycles, and means every
 * entertainment card in every year is the same hue.
 */
const DOMAIN_COLOR_INDEX: Record<RecapStoryDomain, number> = {
  overview: 0,
  health: 1,
  entertainment: 2,
  "people-places": 3,
  life: 4,
};

export type RecapStoryCard = {
  /** Stable across renders and years — used as the React key and as the
   * card's slug in tests. */
  id: string;
  domain: RecapStoryDomain;
  /** Fixed palette slot for the card's domain, resolved to a real colour by
   * the component via `categoricalColor`. */
  colorIndex: number;
  /** Small label above the reveal ("Your year in mood"). */
  kicker: string;
  /** The reveal itself — a number, a name, a date. Pre-formatted, because
   * what counts as readable differs per card ("7h 12m", "68", "Berlin"). */
  value: string;
  /** Trails the value in smaller type ("/ 100", "days"). Null when the value
   * already reads as a whole thing. */
  unit: string | null;
  /** One line under the reveal, saying what the number is. */
  headline: string;
  /** Supporting line — usually the year-over-year comparison. Null when
   * there's no prior period to compare against, which is the earliest-year
   * case #130 requires be handled as its own state rather than a 0% delta. */
  detail: string | null;
  /** Up to three supporting names. Empty for cards that don't have any. */
  items: string[];
};

/** A candidate card plus the weight that decides whether it survives a
 * crowded year. Weights are only ever compared within a domain — across
 * domains, coverage wins (see `selectCards`).
 *
 * The weight wraps the card rather than sitting on it so it can't leak
 * across the server/client boundary as a prop nobody reads. */
type Candidate = { card: RecapStoryCard; weight: number };

/**
 * The ceiling #175 sets. Eight is where a "story" stops being one and starts
 * being the report it sits above.
 */
export const MAX_STORY_CARDS = 8;

/**
 * The monthly story's ceiling (#176). A month has far less to say than a
 * year, and #176's answer to that is fewer cards rather than the same eight
 * dealt from thinner data — five is the opener plus one card for each of
 * the four domains when every one of them has something, which is exactly
 * what `selectCards`' breadth-first pass fills first anyway.
 */
export const MAX_MONTH_STORY_CARDS = 5;

/**
 * Cards that only mean something over a year and are never dealt for a
 * month, or for a chapter short enough to be told like one.
 *
 * - `subs-most-improved`: a sub's daily average moving between two
 *   adjacent months is a handful of days either side, and calling that
 *   "most improved" presents noise as a trend. The report's sub averages
 *   still show per month; only the mover framing is dropped.
 */
const YEAR_ONLY_CARD_IDS = new Set(["subs-most-improved"]);

/**
 * Below this, the story tier is skipped entirely and the full report shows
 * on its own.
 *
 * A two-card "story" is a worse version of the report, not a shorter one —
 * it's the opener plus a single stat, with nothing to sequence. Three is the
 * fewest that still reads as a progression. A year sparse enough to fall
 * under it (one logged day, an import artifact) isn't a year to animate;
 * `buildRecapStory` returns an empty list and the page renders the report
 * expanded.
 */
export const MIN_STORY_CARDS = 3;

export type RecapStoryInput = {
  periodLabel: string;
  /** What the period is, for copy that names it generically ("Your month
   * in mood") and for which cards and how many are dealt. Null for an
   * arbitrary window, which is told like a year. "chapter" is a life
   * chapter (#519): named as one, and dealt like a year unless `compact`. */
  periodUnit: "year" | "month" | "chapter" | null;
  /** Deal the month-sized story — `MAX_MONTH_STORY_CARDS`, no year-only
   * cards — for a period that isn't a month but is about as short as one.
   * Set for short chapters (#519, `isCompactChapter`); a month is always
   * compact regardless. */
  compact?: boolean;
  priorLabel: string;
  loggedDays: number;
  priorLoggedDays: number;
  health: RecapHealth;
  body: RecapBody;
  work: RecapWork;
  screenTime: RecapScreenTime;
  entertainment: RecapEntertainment;
  peoplePlaces: RecapPeoplePlaces;
  subs: RecapSubs;
  moments: RecapMoment[];
  lifeEvents: RecapLifeEvent[];
};

/** Averages of a 0-100 score read better whole — matching the report's own
 * `formatScore`, so the story and the section below it never disagree by a
 * rounding step. */
function formatScore(value: number): string {
  return Math.round(value).toString();
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * The "vs. last year" line, or null when there's nothing honest to compare
 * against.
 *
 * Null rather than a "0%" or an omitted-but-implied line: `prior` is already
 * null by the time it reaches here whenever the prior period failed its own
 * coverage check, so a missing comparison means "we don't know", never "no
 * change". An exact tie is its own sentence for the same reason.
 */
function comparisonLine(
  current: number,
  prior: number | null,
  priorLabel: string,
  format: (value: number) => string,
): string | null {
  if (prior === null) return null;
  const delta = current - prior;
  if (delta === 0) return `Same as ${priorLabel}.`;
  const direction = delta > 0 ? "Up" : "Down";
  return `${direction} ${format(Math.abs(delta))} from ${priorLabel}.`;
}

/** The report shows sleep as hours-and-minutes; the story matches it. */
function formatMinutes(minutes: number): string {
  return formatDuration(minutes / 60);
}

function buildCandidates(input: RecapStoryInput): Candidate[] {
  const { periodLabel, priorLabel, health, body, work, screenTime, entertainment, peoplePlaces, subs } = input;
  // An arbitrary window has no better generic noun than "year" had before
  // months existed; no route builds one today. A chapter is named as one:
  // "Your chapter in mood" for an eight-year home is true where "Your year
  // in mood" isn't.
  const noun = input.periodUnit ?? "year";
  const { happiness, sleep, exercise } = health;
  const candidates: Candidate[] = [];

  const add = (
    card: Omit<RecapStoryCard, "colorIndex" | "items"> & { items?: string[]; weight: number },
  ) => {
    const { weight, items = [], ...rest } = card;
    candidates.push({
      card: { ...rest, items, colorIndex: DOMAIN_COLOR_INDEX[rest.domain] },
      weight,
    });
  };

  // --- Overview -----------------------------------------------------------
  if (input.loggedDays > 0) {
    add({
      id: "days-logged",
      domain: "overview",
      kicker: `Your ${periodLabel}`,
      value: input.loggedDays.toLocaleString(),
      unit: plural(input.loggedDays, "day"),
      headline: `You showed up and wrote ${periodLabel} down.`,
      detail: comparisonLine(
        input.loggedDays,
        input.priorLoggedDays > 0 ? input.priorLoggedDays : null,
        priorLabel,
        (value) => `${value} ${plural(value, "day")}`,
      ),
      weight: 100,
    });
  }

  // --- Health -------------------------------------------------------------
  // Averages are gated on MIN_DAYS_FOR_AVERAGE, the same threshold the
  // report's own cards use — a mean over four logged days isn't a period's
  // mood, and the story has no "insufficient" state to fall back on because
  // a card that can't say anything simply isn't dealt.
  if (happiness.average !== null && happiness.daysLogged >= MIN_DAYS_FOR_AVERAGE) {
    add({
      id: "happiness-average",
      domain: "health",
      kicker: `Your ${noun} in mood`,
      value: formatScore(happiness.average),
      unit: "/ 100",
      headline: `Average happiness across ${happiness.daysLogged} scored ${plural(happiness.daysLogged, "day")}.`,
      detail: comparisonLine(
        happiness.average,
        happiness.priorAverage !== null && happiness.priorDaysLogged >= MIN_DAYS_FOR_AVERAGE
          ? happiness.priorAverage
          : null,
        priorLabel,
        (value) => `${value.toFixed(1)} points`,
      ),
      weight: 90,
    });
  }

  if (sleep.averageMinutes !== null && sleep.nightsLogged >= MIN_DAYS_FOR_AVERAGE) {
    add({
      id: "sleep-average",
      domain: "health",
      kicker: `Your ${noun} in sleep`,
      value: formatMinutes(sleep.averageMinutes),
      unit: null,
      headline: `A typical night, across ${sleep.nightsLogged} logged ${plural(sleep.nightsLogged, "night")}.`,
      detail: comparisonLine(
        sleep.averageMinutes,
        sleep.priorAverageMinutes !== null && sleep.priorNightsLogged >= MIN_DAYS_FOR_AVERAGE
          ? sleep.priorAverageMinutes
          : null,
        priorLabel,
        formatMinutes,
      ),
      weight: 82,
    });
  }

  // Where you slept most (#531). Gated like the report's location table: on
  // nights *with a location recorded*, since most nights have none. Weighted
  // under the average so it only surfaces once health has room for a
  // second sleep card.
  const located = sleep.locations;
  const topLocation = located.rows.find((row) => !row.other && row.nights > 0);
  if (topLocation && located.locatedNights >= MIN_DAYS_FOR_AVERAGE) {
    const priorTop = located.rows.find((row) => row.label === topLocation.label);
    add({
      id: "sleep-location",
      domain: "health",
      kicker: "Where you slept most",
      value: topLocation.label,
      unit: null,
      headline: `${topLocation.nights} of ${located.locatedNights} nights with a location recorded.`,
      detail:
        located.priorLocatedNights >= MIN_DAYS_FOR_AVERAGE && priorTop
          ? `${priorTop.priorNights} of ${located.priorLocatedNights} in ${priorLabel}.`
          : null,
      items: located.rows
        .filter((row) => row !== topLocation && !row.other && row.nights > 0)
        .slice(0, 2)
        .map((row) => row.label),
      weight: 64,
    });
  }

  if (exercise.daysTrained > 0) {
    add({
      id: "days-trained",
      domain: "health",
      kicker: `Your ${noun} in training`,
      value: exercise.daysTrained.toLocaleString(),
      unit: plural(exercise.daysTrained, "day"),
      headline: "Days you trained.",
      detail: comparisonLine(
        exercise.daysTrained,
        exercise.priorDaysTrained > 0 ? exercise.priorDaysTrained : null,
        priorLabel,
        (value) => `${value} ${plural(value, "day")}`,
      ),
      weight: 74,
    });
  }

  // Body & habits (#529). Per-day averages, not totals, lead — a total over
  // a sparsely-logged period understates it (see recap-body.ts) — and they
  // clear the same coverage floor as every other average. Weight and
  // training hours stay report-only: neither has a number that reads as a
  // reveal without implying a direction.
  for (const [metric, id, kicker, unit, weight] of [
    [body.coffee, "coffee", "Your daily coffee", "cups", 58],
    [body.distance, "distance", "Your daily walk", "km", 56],
  ] as const) {
    if (metric.average === null || metric.daysLogged < MIN_DAYS_FOR_AVERAGE) continue;
    add({
      id,
      domain: "health",
      kicker,
      value: metric.average.toFixed(1),
      unit,
      headline: `A typical day, across ${metric.daysLogged} logged ${plural(metric.daysLogged, "day")}.`,
      detail: comparisonLine(
        metric.average,
        metric.priorAverage !== null && metric.priorDaysLogged >= MIN_DAYS_FOR_AVERAGE
          ? metric.priorAverage
          : null,
        priorLabel,
        (value) => `${value.toFixed(1)} ${unit}`,
      ),
      weight,
    });
  }

  // Screen time (#530): phone only, the one device logged long enough to
  // have years behind it. Same gate and neutral phrasing as coffee and
  // walking, and weighted just under them — a habit card, first out of a
  // crowded health domain.
  const { phone } = screenTime;
  if (phone.average !== null && phone.daysLogged >= MIN_DAYS_FOR_AVERAGE) {
    add({
      id: "phone-time",
      domain: "health",
      kicker: "Your daily phone time",
      value: formatMinutes(phone.average),
      unit: null,
      headline: `A typical day, across ${phone.daysLogged} logged ${plural(phone.daysLogged, "day")}.`,
      detail: comparisonLine(
        phone.average,
        phone.priorAverage !== null && phone.priorDaysLogged >= MIN_DAYS_FOR_AVERAGE ? phone.priorAverage : null,
        priorLabel,
        formatMinutes,
      ),
      weight: 54,
    });
  }

  if (happiness.best !== null) {
    add({
      id: "best-day",
      domain: "health",
      kicker: "Your best day",
      value: formatDate(happiness.best.date, "dayYear"),
      unit: null,
      headline: `The highest you scored a day all ${periodLabel}.`,
      detail: `${formatScore(happiness.best.happiness)} / 100.`,
      weight: 70,
    });
  }

  // Gated like the averages: a run is only meaningful against enough logged
  // days, and a day-long "streak" isn't a story. Two days is the floor for
  // calling it a streak at all. Weight sits below best-day so it is first
  // out in a crowded health domain.
  if (
    happiness.streak !== null &&
    happiness.streak.length >= 2 &&
    happiness.daysLogged >= MIN_DAYS_FOR_AVERAGE
  ) {
    const { streak } = happiness;
    add({
      id: "good-day-streak",
      domain: "health",
      kicker: "Your longest streak",
      value: streak.length.toLocaleString(),
      unit: plural(streak.length, "day"),
      headline: `Good days in a row, every one logged and scoring ${GOOD_DAY_THRESHOLD}+.`,
      detail: `${formatDate(streak.start, "dayYear")} to ${formatDate(streak.end, "dayYear")}.`,
      weight: 66,
    });
  }

  if (subs.mostImproved !== null) {
    const mover = subs.mostImproved;
    add({
      id: "subs-most-improved",
      domain: "health",
      kicker: "Most improved",
      value: mover.name,
      unit: null,
      headline: `Down to ${mover.average.toFixed(1)} a day, on average.`,
      detail: `Was ${mover.priorAverage.toFixed(1)} in ${priorLabel}.`,
      weight: 62,
    });
  }

  // --- Entertainment ------------------------------------------------------
  // The headline medium is whichever was actually consumed most, not a
  // hardcoded "movies" — an import-heavy music year and a reading year should
  // lead with different things.
  const topMedium = [...entertainment.totals]
    .filter((total) => total.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  if (topMedium) {
    add({
      id: "top-medium",
      domain: "entertainment",
      kicker: `Your ${periodLabel} in ${topMedium.label.toLowerCase()}`,
      value: topMedium.count.toLocaleString(),
      unit: topMedium.unit,
      headline: `More ${topMedium.label.toLowerCase()} than anything else you logged.`,
      detail: comparisonLine(
        topMedium.count,
        topMedium.priorCount > 0 ? topMedium.priorCount : null,
        priorLabel,
        (value) => value.toLocaleString(),
      ),
      weight: 86,
    });
  }

  if (entertainment.topArtist !== null) {
    const artist = entertainment.topArtist;
    add({
      id: "top-artist",
      domain: "entertainment",
      kicker: "Your top artist",
      value: artist.name,
      unit: null,
      headline: `${formatMinutes(artist.minutes)} of listening.`,
      detail: entertainment.topGenre !== null ? `Top genre: ${entertainment.topGenre.name}.` : null,
      weight: 84,
    });
  }

  // Top picks (#528): one card each, the #1 row of the section's tables.
  // Low weights on purpose — these sit below the artist/movie cards and
  // only survive a crowded year if the entertainment domain gets seconds.
  const { picks } = entertainment;
  const topSong = picks.songs[0];
  if (topSong) {
    add({
      id: "top-song",
      domain: "entertainment",
      kicker: "Your top song",
      value: topSong.name,
      unit: null,
      headline: `${formatMinutes(Math.round(topSong.value * 60))} of listening${topSong.detail ? `, by ${topSong.detail}` : ""}.`,
      detail: null,
      weight: 74,
    });
  }
  const topPodcast = picks.podcasts[0];
  if (topPodcast) {
    add({
      id: "top-podcast",
      domain: "entertainment",
      kicker: "Your top podcast",
      value: topPodcast.name,
      unit: null,
      headline: `${formatMinutes(Math.round(topPodcast.value * 60))} of listening.`,
      detail: null,
      weight: 66,
    });
  }
  const topGame = picks.games[0];
  if (topGame) {
    add({
      id: "top-game",
      domain: "entertainment",
      kicker: "Your top game",
      value: topGame.name,
      unit: null,
      headline: `${formatMinutes(Math.round(topGame.value * 60))} played over ${topGame.count} ${plural(topGame.count, "session")}.`,
      detail: null,
      weight: 62,
    });
  }
  const topSports = picks.sports[0];
  if (topSports) {
    add({
      id: "top-team",
      domain: "entertainment",
      kicker: picks.sportsMode === "team" ? "Your top team" : "Your top league",
      value: topSports.name,
      unit: null,
      headline: `${formatMinutes(Math.round(topSports.value * 60))} watched across ${topSports.count} ${plural(topSports.count, "game")}.`,
      detail: null,
      weight: 60,
    });
  }

  if (entertainment.topMovie !== null) {
    add({
      id: "top-movie",
      domain: "entertainment",
      kicker: "Your top movie",
      value: entertainment.topMovie.title,
      unit: null,
      headline: `Your highest-ranked watch of ${periodLabel}.`,
      detail: null,
      weight: 76,
    });
  }

  if (entertainment.firsts.newArtists.total > 0) {
    const { total, examples } = entertainment.firsts.newArtists;
    add({
      id: "new-artists",
      domain: "entertainment",
      kicker: "New to you",
      value: total.toLocaleString(),
      unit: plural(total, "artist"),
      headline: `Artists you heard for the first time in ${periodLabel}.`,
      detail: null,
      items: examples.slice(0, 3),
      weight: 68,
    });
  }

  if (entertainment.topBook !== null) {
    add({
      id: "top-book",
      domain: "entertainment",
      kicker: "Your top book",
      value: entertainment.topBook.title,
      unit: null,
      headline: `Your highest-ranked read of ${periodLabel}.`,
      detail: null,
      weight: 64,
    });
  }

  // --- People & places ----------------------------------------------------
  if (peoplePlaces.topPerson !== null) {
    const person = peoplePlaces.topPerson;
    add({
      id: "top-person",
      domain: "people-places",
      kicker: "Your person",
      value: person.name,
      unit: null,
      headline: `Logged together on ${person.days} ${plural(person.days, "day")}.`,
      detail: comparisonLine(
        person.days,
        person.priorDays,
        priorLabel,
        (value) => `${value} ${plural(value, "day")}`,
      ),
      weight: 88,
    });
  }

  if (peoplePlaces.countriesVisited.total > 0) {
    const { total, priorTotal } = peoplePlaces.countriesVisited;
    add({
      id: "countries-visited",
      domain: "people-places",
      kicker: "On the map",
      value: total.toLocaleString(),
      unit: plural(total, "country", "countries"),
      headline: `Countries you spent time in during ${periodLabel}.`,
      detail: comparisonLine(total, priorTotal > 0 ? priorTotal : null, priorLabel, (value) =>
        `${value} ${plural(value, "country", "countries")}`,
      ),
      items: peoplePlaces.newCountries.examples.slice(0, 3),
      weight: 78,
    });
  }

  if (peoplePlaces.placesVisited.total > 0) {
    const { total, priorTotal } = peoplePlaces.placesVisited;
    add({
      id: "places-visited",
      domain: "people-places",
      kicker: "Where you were",
      value: total.toLocaleString(),
      unit: plural(total, "place"),
      headline: `Distinct places logged across ${periodLabel}.`,
      detail: comparisonLine(
        total,
        priorTotal > 0 ? priorTotal : null,
        priorLabel,
        (value) => `${value} ${plural(value, "place")}`,
      ),
      weight: 72,
    });
  }

  if (peoplePlaces.newPeople.total > 0) {
    const { total, examples } = peoplePlaces.newPeople;
    add({
      id: "new-people",
      domain: "people-places",
      kicker: "New faces",
      value: total.toLocaleString(),
      unit: plural(total, "person", "people"),
      headline: `People logged for the first time in ${periodLabel}.`,
      detail: null,
      items: examples.slice(0, 3),
      weight: 66,
    });
  }

  // --- Life ---------------------------------------------------------------
  if (input.lifeEvents.length > 0) {
    const events = input.lifeEvents;
    add({
      id: "life-events",
      domain: "life",
      kicker: "What changed",
      value: events.length.toLocaleString(),
      unit: plural(events.length, "life event"),
      headline: `Jobs, homes and relationships that moved in ${periodLabel}.`,
      detail: null,
      items: events.slice(0, 3).map((event) => event.title),
      weight: 87,
    });
  }

  if (input.moments.length > 0) {
    // Sorted here rather than trusting arrival order: the moments engine
    // mixes signals of different kinds, and the story only has room for the
    // strongest few.
    const ranked = [...input.moments].sort((a, b) => b.magnitude - a.magnitude);
    add({
      id: "moments",
      domain: "life",
      kicker: "Moments",
      value: ranked.length.toLocaleString(),
      unit: plural(ranked.length, "moment"),
      headline: `Days ${periodLabel} that stood out from the rest.`,
      detail: null,
      items: ranked.slice(0, 3).map((moment) => moment.headline),
      weight: 80,
    });
  }

  // Days worked (#530) sits in `life` beside the job changes it explains,
  // rather than taking a sixth domain the palette has no slot for. Read
  // from `dayType`, so it has years of history where hours don't (see
  // recap-work.ts). Weighted under life events and moments: it's the
  // backdrop, they're what changed.
  if (work.daysWorked > 0) {
    add({
      id: "days-worked",
      domain: "life",
      kicker: `Your ${noun} at work`,
      value: work.daysWorked.toLocaleString(),
      unit: plural(work.daysWorked, "day"),
      headline: `Days you worked, of ${work.daysTyped} with a day type logged.`,
      detail: comparisonLine(
        work.daysWorked,
        work.priorDaysTyped > 0 ? work.priorDaysWorked : null,
        priorLabel,
        (value) => `${value} ${plural(value, "day")}`,
      ),
      weight: 60,
    });
  }

  return candidates;
}

/**
 * Fills the story's slots breadth-first across domains.
 *
 * The pass order is what makes #175's "covers all four v1 domains" hold
 * without a hardcoded slot per domain: every domain that has *anything* gets
 * its strongest card before any domain gets a second one. Only once each has
 * been represented do the remaining slots go to the next-strongest cards
 * anywhere. A year with four domains of data therefore always shows all
 * four; a year with one domain spends its whole story there rather than
 * padding with empties.
 */
function selectCards(candidates: Candidate[], limit: number): Candidate[] {
  const byDomain = new Map<RecapStoryDomain, Candidate[]>();
  for (const candidate of candidates) {
    const bucket = byDomain.get(candidate.card.domain) ?? [];
    bucket.push(candidate);
    byDomain.set(candidate.card.domain, bucket);
  }
  for (const bucket of byDomain.values()) {
    bucket.sort((a, b) => b.weight - a.weight);
  }

  const selected: Candidate[] = [];
  let exhausted = false;
  while (selected.length < limit && !exhausted) {
    exhausted = true;
    for (const domain of DOMAIN_ORDER) {
      if (selected.length >= limit) break;
      const next = byDomain.get(domain)?.shift();
      if (next === undefined) continue;
      selected.push(next);
      exhausted = false;
    }
  }
  return selected;
}

/**
 * The cards a period's story is told with, in narrative order.
 *
 * Returns an empty list — not a placeholder story — when the period has
 * fewer than `MIN_STORY_CARDS` worth of real data. The caller renders the
 * full report on its own in that case, which is the honest answer for a year
 * that predates most of this app's tracking.
 */
export function buildRecapStory(input: RecapStoryInput): RecapStoryCard[] {
  const compact = input.periodUnit === "month" || input.compact === true;
  const candidates = buildCandidates(input).filter(
    (candidate) => !compact || !YEAR_ONLY_CARD_IDS.has(candidate.card.id)
  );
  const selected = selectCards(candidates, compact ? MAX_MONTH_STORY_CARDS : MAX_STORY_CARDS);
  if (selected.length < MIN_STORY_CARDS) return [];

  const domainRank = new Map(DOMAIN_ORDER.map((domain, index) => [domain, index]));
  return selected
    .sort((a, b) => {
      const byDomain =
        (domainRank.get(a.card.domain) ?? 0) - (domainRank.get(b.card.domain) ?? 0);
      return byDomain !== 0 ? byDomain : b.weight - a.weight;
    })
    .map((candidate) => candidate.card);
}
