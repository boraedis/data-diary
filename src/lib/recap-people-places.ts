import { inArray } from "drizzle-orm";
import { days, people, places } from "@/db/schema";
import { getDb } from "@/lib/db";
import { normalizeCountryName } from "@/lib/geo/country-names";
import { firstSeenInPeriod } from "@/lib/recap-entertainment";
import type { RecapPeriod } from "@/lib/recap";
import type { CountryVisitEntry, PlaceLeaderboardEntry } from "@/lib/charts";

// The recap's people & places section (issue #172, epic #130).
//
// Everything here is computed from one all-time read of `days`' people and
// place slots. That isn't an optimization shortcut — "first appearance"
// questions are unanswerable from the period's own rows, since the whole
// point is whether anything earlier exists. Aggregating in TypeScript
// rather than SQL follows the precedent `getPeopleNetworkData` and
// `getCountryVisitData` already set in `charts.ts` for exactly this table:
// it's a few thousand rows, and "the root ancestor of whichever of two
// nullable FKs is set, deduped per day, but only counting keys never seen
// before this year" is far more legible as a fold than as a query.
//
// **Negative-person slots are deliberately excluded.** `days` also carries
// `negativePerson1Id`..`3`, and `getPeopleNetworkData` unions them with the
// positive ones because a co-occurrence network is about who shows up in
// your days at all. A recap highlight is not neutral in that way — surfacing
// "your most-logged person" from a slot that means the opposite would be a
// genuinely bad thing to hand someone at year's end. #130's own domain list
// asks for the *positive* slots specifically; this is that, not an
// oversight.

/** One day's people and place references, flattened out of the fixed slot
 * columns. Both arrays are already de-nulled and deduplicated. */
export type RecapDaySlots = {
  date: string;
  /** Positive slots only — see the note above. */
  personIds: number[];
  /** In slot order: index 0 is the day's first place slot, 1 the second.
   * Order matters — the leaderboard weights them differently. */
  placeIds: number[];
};

export type RecapPeoplePlacesInput = {
  /** Every logged day, all time, not just the period's. */
  days: RecapDaySlots[];
  personNames: Map<number, string>;
  placeNames: Map<number, string>;
  /** Normalized country name for each place, resolved by walking to the
   * root of its `idPath`. Null where a place has no resolvable root. */
  countryByPlaceId: Map<number, string | null>;
  /** Each place's root-ancestor color, the identity the leaderboard paints
   * bars with (see `places.color`'s schema comment on why only roots carry
   * one). */
  colorByPlaceId: Map<number, string | null>;
};

export type RecapPeoplePlaces = {
  /** Null when nobody was logged in the period at all. */
  topPerson: { name: string; days: number; priorDays: number | null } | null;
  newPeople: RecapDiscovery;
  newPlaces: RecapDiscovery;
  newCountries: RecapDiscovery;
  /** Distinct places and countries touched, with the prior period's counts
   * for the year-over-year line. */
  placesVisited: RecapCount;
  countriesVisited: RecapCount;
  /** Period-scoped, in the exact shape `PlaceLeaderboard` already takes. */
  leaderboard: PlaceLeaderboardEntry[];
  /** Period-scoped, in the exact shape `WorldVisitsChart` already takes. */
  countryVisits: CountryVisitEntry[];
};

export type RecapCount = { total: number; priorTotal: number };
export type RecapDiscovery = RecapCount & { examples: string[] };

/** How many discoveries to name before falling back to a bare count. Three
 * reads as a highlight; the first year of any catalog would otherwise list
 * hundreds, since everything in it is technically new. */
const MAX_EXAMPLES = 3;

const PLACE_SLOT_WEIGHTS = [2, 1];

/** Ten, where the standalone places chart shows thirty.
 *
 * That chart is the whole point of its own page, so a long tail is the
 * feature. Here the leaderboard is one block inside a report that already
 * has several sections above and below it, and thirty rows of places
 * visited six times each stops being a highlight and starts being a table
 * to scroll past. The underlying scores are unchanged — this is only how
 * many get shown. */
const LEADERBOARD_SIZE = 10;

/**
 * The whole section, computed from all-time slot data.
 *
 * Exported and pure so the rules below — first-appearance, distinct-day
 * counting, slot weighting — are testable without a database, which is
 * where their actual complexity lives.
 */
export function buildRecapPeoplePlaces(
  input: RecapPeoplePlacesInput,
  period: RecapPeriod,
  prior: RecapPeriod
): RecapPeoplePlaces {
  const inPeriod = (date: string, p: RecapPeriod) => date >= p.start && date <= p.end;

  // --- People ---
  // Counted as *distinct days logged with*, not slot mentions. Nothing
  // stops the same person occupying two slots on one day (the day form
  // rejects duplicate slots, not duplicate people), and "84 days together"
  // is the honest reading of that number either way.
  const personDays = new Map<number, number>();
  const priorPersonDays = new Map<number, number>();
  for (const day of input.days) {
    const target = inPeriod(day.date, period)
      ? personDays
      : inPeriod(day.date, prior)
        ? priorPersonDays
        : null;
    if (!target) continue;
    for (const id of new Set(day.personIds)) target.set(id, (target.get(id) ?? 0) + 1);
  }

  const top = [...personDays.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPerson = top
    ? {
        name: input.personNames.get(top[0]) ?? "Unknown",
        days: top[1],
        // Their own count last period, not last period's top person — the
        // card names one person, so the comparison has to be about that
        // same person or it isn't a comparison at all. Null when they
        // weren't logged at all last period, which reads as "new to your
        // year" rather than as a fall from zero.
        priorDays: priorPersonDays.get(top[0]) ?? null,
      }
    : null;

  // --- Appearances, for both the first-appearance and distinct-count rules ---
  const personAppearances: { key: string; date: string }[] = [];
  const placeAppearances: { key: string; date: string }[] = [];
  const countryAppearances: { key: string; date: string }[] = [];
  for (const day of input.days) {
    for (const id of day.personIds) personAppearances.push({ key: String(id), date: day.date });
    for (const id of day.placeIds) {
      placeAppearances.push({ key: String(id), date: day.date });
      const country = input.countryByPlaceId.get(id);
      if (country) countryAppearances.push({ key: country, date: day.date });
    }
  }

  const discovery = (
    appearances: { key: string; date: string }[],
    label: (key: string) => string
  ): RecapDiscovery => {
    const current = firstSeenInPeriod(period, appearances);
    return {
      total: current.length,
      priorTotal: firstSeenInPeriod(prior, appearances).length,
      examples: current.slice(0, MAX_EXAMPLES).map(label),
    };
  };

  const personName = (key: string) => input.personNames.get(Number(key)) ?? "Unknown";
  const placeName = (key: string) => input.placeNames.get(Number(key)) ?? "Unknown";

  const distinct = (appearances: { key: string; date: string }[]): RecapCount => ({
    total: new Set(appearances.filter((a) => inPeriod(a.date, period)).map((a) => a.key)).size,
    priorTotal: new Set(appearances.filter((a) => inPeriod(a.date, prior)).map((a) => a.key)).size,
  });

  // --- Places leaderboard ---
  // The legacy `location_leaderboard` weighting, unchanged: a day's first
  // place slot counts double the second. Kept identical to
  // `getPlaceLeaderboardData` so the recap's ranking and the standalone
  // places chart can't disagree about what "most visited" means — the only
  // difference between them is the date window.
  const placeScores = new Map<number, number>();
  for (const day of input.days) {
    if (!inPeriod(day.date, period)) continue;
    day.placeIds.forEach((id, slot) => {
      const weight = PLACE_SLOT_WEIGHTS[slot] ?? 1;
      placeScores.set(id, (placeScores.get(id) ?? 0) + weight);
    });
  }
  const leaderboard = [...placeScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEADERBOARD_SIZE)
    .map(([id, value]) => ({
      name: input.placeNames.get(id) ?? "Unknown",
      value,
      color: input.colorByPlaceId.get(id) ?? null,
    }));

  // --- Country choropleth ---
  // Distinct *days present*, matching getCountryVisitData: a day whose two
  // place slots are both in France counts once, because this answers "was
  // I in France that day", not "how often did France get logged".
  const dayCountryPairs = new Set<string>();
  for (const day of input.days) {
    if (!inPeriod(day.date, period)) continue;
    for (const id of day.placeIds) {
      const country = input.countryByPlaceId.get(id);
      if (country) dayCountryPairs.add(`${day.date}\0${country}`);
    }
  }
  const countryDays = new Map<string, number>();
  for (const pair of dayCountryPairs) {
    const country = pair.split("\0")[1];
    countryDays.set(country, (countryDays.get(country) ?? 0) + 1);
  }

  return {
    topPerson,
    newPeople: discovery(personAppearances, personName),
    newPlaces: discovery(placeAppearances, placeName),
    newCountries: discovery(countryAppearances, (key) => key),
    placesVisited: distinct(placeAppearances),
    countriesVisited: distinct(countryAppearances),
    leaderboard,
    countryVisits: [...countryDays.entries()]
      .map(([country, n]) => ({ country, days: n }))
      .sort((a, b) => b.days - a.days),
  };
}

/**
 * Fetches the all-time slot data the section is built from, then folds it.
 *
 * Three queries rather than one join: the day rows, then names for only the
 * people and places those rows actually reference, then the root ancestors
 * those places resolve to. Same shape `getCountryVisitData` uses, and the
 * same reason — a place is a leaf in an arbitrary-depth tree, so its
 * country comes from the first segment of `idPath`, never from an assumed
 * depth.
 */
export async function getRecapPeoplePlaces(
  period: RecapPeriod,
  prior: RecapPeriod
): Promise<RecapPeoplePlaces> {
  const db = getDb();
  const dayRows = await db
    .select({
      date: days.date,
      p1: days.positivePerson1Id,
      p2: days.positivePerson2Id,
      p3: days.positivePerson3Id,
      p4: days.positivePerson4Id,
      p5: days.positivePerson5Id,
      p6: days.positivePerson6Id,
      p7: days.positivePerson7Id,
      place1Id: days.place1Id,
      place2Id: days.place2Id,
    })
    .from(days);

  const slots: RecapDaySlots[] = dayRows.map((row) => ({
    date: row.date,
    personIds: [...new Set([row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7].filter(isId))],
    // Slot order preserved (place1 then place2) because the leaderboard
    // weights the first slot double; a Set would not guarantee it.
    placeIds: [row.place1Id, row.place2Id].filter(isId),
  }));

  const personIds = [...new Set(slots.flatMap((s) => s.personIds))];
  const placeIds = [...new Set(slots.flatMap((s) => s.placeIds))];

  const [personRows, placeRows] = await Promise.all([
    personIds.length
      ? db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, personIds))
      : [],
    placeIds.length
      ? db
          .select({ id: places.id, name: places.name, idPath: places.idPath })
          .from(places)
          .where(inArray(places.id, placeIds))
      : [],
  ]);

  const rootIdByPlaceId = new Map<number, number | null>();
  for (const place of placeRows) {
    const rootId = place.idPath?.split("/")[0];
    rootIdByPlaceId.set(place.id, rootId ? Number(rootId) : null);
  }
  const rootIds = [...new Set([...rootIdByPlaceId.values()].filter(isId))];
  const rootRows = rootIds.length
    ? await db
        .select({ id: places.id, name: places.name, color: places.color })
        .from(places)
        .where(inArray(places.id, rootIds))
    : [];
  const rootById = new Map(rootRows.map((r) => [r.id, r]));

  const countryByPlaceId = new Map<number, string | null>();
  const colorByPlaceId = new Map<number, string | null>();
  for (const [placeId, rootId] of rootIdByPlaceId) {
    const root = rootId === null ? undefined : rootById.get(rootId);
    // Normalized here, once, so "England" and "United Kingdom" are the same
    // country everywhere in this section — the map join, the visited count
    // and the new-countries list all agree instead of each normalizing (or
    // not) on its own.
    countryByPlaceId.set(placeId, root ? normalizeCountryName(root.name) : null);
    colorByPlaceId.set(placeId, root?.color ?? null);
  }

  return buildRecapPeoplePlaces(
    {
      days: slots,
      personNames: new Map(personRows.map((r) => [r.id, r.name])),
      placeNames: new Map(placeRows.map((r) => [r.id, r.name])),
      countryByPlaceId,
      colorByPlaceId,
    },
    period,
    prior
  );
}

function isId(value: number | null): value is number {
  return value !== null;
}
