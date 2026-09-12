import { describe, expect, it } from "vitest";
import {
  MAX_STORY_CARDS,
  MIN_STORY_CARDS,
  buildRecapStory,
  type RecapStoryInput,
} from "@/lib/recap-story";

// Covers #175's selection rules — the part of the story view that has real
// logic rather than layout: which cards a year earns, that every domain with
// data gets represented before any domain gets seconds, and that a sparse
// historical year comes out shorter instead of padded with empties.

/** A year with nothing in it. Every test starts here and switches on only
 * the data it's actually about, which is also the fixture that proves the
 * "no data, no card" rule — anything that shows up unasked is a bug. */
function emptyInput(overrides: Partial<RecapStoryInput> = {}): RecapStoryInput {
  return {
    periodLabel: "2025",
    priorLabel: "2024",
    loggedDays: 0,
    priorLoggedDays: 0,
    health: {
      happiness: {
        average: null,
        priorAverage: null,
        daysLogged: 0,
        priorDaysLogged: 0,
        best: null,
        worst: null,
      },
      sleep: {
        averageMinutes: null,
        priorAverageMinutes: null,
        nightsLogged: 0,
        priorNightsLogged: 0,
        longest: null,
        shortest: null,
      },
      exercise: { daysTrained: 0, priorDaysTrained: 0, exercisesLogged: 0 },
    },
    entertainment: {
      totals: [],
      topMovie: null,
      topBook: null,
      topArtist: null,
      topGenre: null,
      firsts: { newArtists: { total: 0, examples: [] }, newMovieGenres: [] },
    },
    peoplePlaces: {
      topPerson: null,
      newPeople: { total: 0, priorTotal: 0, examples: [] },
      newPlaces: { total: 0, priorTotal: 0, examples: [] },
      newCountries: { total: 0, priorTotal: 0, examples: [] },
      placesVisited: { total: 0, priorTotal: 0 },
      countriesVisited: { total: 0, priorTotal: 0 },
      leaderboard: [],
      countryVisits: [],
    },
    subs: { summaries: [], mostImproved: null, biggestIncrease: null, daysWithSubData: 0 },
    moments: [],
    lifeEvents: [],
    ...overrides,
  };
}

/** A year with something real in all four v1 domains plus the opener. */
function fullInput(overrides: Partial<RecapStoryInput> = {}): RecapStoryInput {
  const base = emptyInput();
  return {
    ...base,
    loggedDays: 340,
    priorLoggedDays: 300,
    health: {
      happiness: {
        average: 68.4,
        priorAverage: 64.2,
        daysLogged: 300,
        priorDaysLogged: 280,
        best: { date: "2025-06-14", happiness: 96 },
        worst: { date: "2025-02-03", happiness: 12 },
      },
      sleep: {
        averageMinutes: 432,
        priorAverageMinutes: 410,
        nightsLogged: 290,
        priorNightsLogged: 270,
        longest: null,
        shortest: null,
      },
      exercise: { daysTrained: 120, priorDaysTrained: 90, exercisesLogged: 400 },
    },
    entertainment: {
      totals: [
        { key: "movies", label: "Movies", unit: "movies", count: 47, priorCount: 40 },
        { key: "books", label: "Books", unit: "books", count: 12, priorCount: 9 },
      ],
      topMovie: { title: "Dune", rank: 1 },
      topBook: { title: "Piranesi", rank: 1 },
      topArtist: { name: "Radiohead", minutes: 1200 },
      topGenre: { name: "art rock", minutes: 2000 },
      firsts: { newArtists: { total: 30, examples: ["Alvvays", "Bicep"] }, newMovieGenres: [] },
    },
    peoplePlaces: {
      topPerson: { name: "Sam", days: 140, priorDays: 120 },
      newPeople: { total: 9, priorTotal: 4, examples: ["Ada"] },
      newPlaces: { total: 20, priorTotal: 11, examples: ["Kreuzberg"] },
      newCountries: { total: 3, priorTotal: 1, examples: ["Japan", "Portugal"] },
      placesVisited: { total: 64, priorTotal: 50 },
      countriesVisited: { total: 7, priorTotal: 5 },
      leaderboard: [],
      countryVisits: [],
    },
    subs: {
      summaries: [],
      mostImproved: { name: "Smoking", change: -1.4, average: 0.6, priorAverage: 2 },
      biggestIncrease: null,
      daysWithSubData: 200,
    },
    moments: [
      { date: "2025-06-14", kind: "happiness-spike", headline: "Best day of the year", detail: null, magnitude: 3 },
      { date: "2025-03-01", kind: "first-country", headline: "First time in Japan", detail: null, magnitude: 9 },
    ],
    lifeEvents: [
      {
        kind: "occupation",
        framing: "started",
        title: "New job",
        detail: null,
        start: "2025-04-01",
        end: null,
        sortDate: "2025-04-01",
        color: null,
      },
    ],
    ...overrides,
  };
}

const idsOf = (input: RecapStoryInput) => buildRecapStory(input).map((card) => card.id);

describe("buildRecapStory", () => {
  it("tells no story for a year with nothing logged", () => {
    expect(buildRecapStory(emptyInput())).toEqual([]);
  });

  it("skips the story tier below the minimum rather than showing a stub", () => {
    // One logged day earns exactly one card, which is a worse report, not a
    // shorter story.
    const cards = buildRecapStory(emptyInput({ loggedDays: 1 }));
    expect(cards).toEqual([]);
  });

  it("caps a data-rich year at the maximum", () => {
    const cards = buildRecapStory(fullInput());
    expect(cards.length).toBe(MAX_STORY_CARDS);
  });

  it("covers every domain that has data before doubling up on any one", () => {
    const domains = buildRecapStory(fullInput()).map((card) => card.domain);
    expect(new Set(domains)).toEqual(
      new Set(["overview", "health", "entertainment", "people-places", "life"]),
    );
  });

  it("opens on the overview and runs in narrative order", () => {
    const domains = buildRecapStory(fullInput()).map((card) => card.domain);
    expect(domains[0]).toBe("overview");
    // Domains never interleave — all of one domain's cards sit together.
    const firstIndexes = domains.map((domain) => domains.indexOf(domain));
    expect(firstIndexes).toEqual([...firstIndexes].sort((a, b) => a - b));
  });

  it("gives a sparse year a shorter but real story", () => {
    const sparse = emptyInput({
      loggedDays: 200,
      health: {
        ...emptyInput().health,
        happiness: {
          average: 70,
          priorAverage: null,
          daysLogged: 180,
          priorDaysLogged: 0,
          best: { date: "2011-08-02", happiness: 91 },
          worst: null,
        },
      },
    });
    const cards = buildRecapStory(sparse);
    expect(cards.length).toBeGreaterThanOrEqual(MIN_STORY_CARDS);
    expect(cards.length).toBeLessThan(MAX_STORY_CARDS);
    expect(cards.map((card) => card.id)).toEqual([
      "days-logged",
      "happiness-average",
      "best-day",
    ]);
  });

  it("holds averages to the coverage threshold but not counts", () => {
    const thin = emptyInput({
      loggedDays: 10,
      health: {
        ...emptyInput().health,
        // Four scored days is not a year's mood...
        happiness: {
          average: 70,
          priorAverage: null,
          daysLogged: 4,
          priorDaysLogged: 0,
          best: { date: "2011-08-02", happiness: 91 },
          worst: null,
        },
        // ...but four days trained is still four days trained.
        exercise: { daysTrained: 4, priorDaysTrained: 0, exercisesLogged: 10 },
      },
    });
    const ids = idsOf(thin);
    expect(ids).not.toContain("happiness-average");
    expect(ids).toContain("days-trained");
  });

  it("leads entertainment with whichever medium was actually consumed most", () => {
    const readingYear = fullInput({
      entertainment: {
        ...fullInput().entertainment,
        totals: [
          { key: "movies", label: "Movies", unit: "movies", count: 3, priorCount: 2 },
          { key: "books", label: "Books", unit: "books", count: 40, priorCount: 20 },
        ],
      },
    });
    const card = buildRecapStory(readingYear).find((c) => c.id === "top-medium");
    expect(card?.value).toBe("40");
    expect(card?.unit).toBe("books");
  });

  it("drops the comparison line when there is no comparable prior period", () => {
    const firstYear = fullInput({
      priorLoggedDays: 0,
      peoplePlaces: { ...fullInput().peoplePlaces, topPerson: { name: "Sam", days: 140, priorDays: null } },
    });
    const cards = buildRecapStory(firstYear);
    expect(cards.find((card) => card.id === "days-logged")?.detail).toBeNull();
    expect(cards.find((card) => card.id === "top-person")?.detail).toBeNull();
  });

  it("says so explicitly when a number did not move", () => {
    const flat = fullInput({ loggedDays: 300, priorLoggedDays: 300 });
    expect(buildRecapStory(flat).find((card) => card.id === "days-logged")?.detail).toBe(
      "Same as 2024.",
    );
  });

  it("colours by domain, so no two domains share a slot and none is cycled", () => {
    const cards = buildRecapStory(fullInput());
    const byDomain = new Map(cards.map((card) => [card.domain, card.colorIndex]));
    // Five domains, five distinct slots — the exact number categoricalColor
    // has before it flattens to grey.
    expect(new Set(byDomain.values()).size).toBe(byDomain.size);
    expect(Math.max(...byDomain.values())).toBeLessThanOrEqual(4);
    // Every card of a domain carries that domain's slot.
    for (const card of cards) expect(card.colorIndex).toBe(byDomain.get(card.domain));
  });

  it("ranks moments by magnitude rather than arrival order", () => {
    // No life events, so moments is what the life domain sends forward — in a
    // year that has both, life events outrank it and take the slot.
    const card = buildRecapStory(fullInput({ lifeEvents: [] })).find((c) => c.id === "moments");
    expect(card?.items[0]).toBe("First time in Japan");
  });

  it("never carries more than three supporting items", () => {
    const cards = buildRecapStory(
      fullInput({
        lifeEvents: Array.from({ length: 9 }, (_, i) => ({
          kind: "residence" as const,
          framing: "started" as const,
          title: `Move ${i}`,
          detail: null,
          start: "2025-01-01",
          end: null,
          sortDate: "2025-01-01",
          color: null,
        })),
      }),
    );
    for (const card of cards) expect(card.items.length).toBeLessThanOrEqual(3);
  });
});
