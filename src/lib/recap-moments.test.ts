import { describe, expect, it } from "vitest";
import {
  buildRecapMoments,
  happinessBaseline,
  happinessMoments,
  happinessMomentsFromBaseline,
  MIN_DAYS_FOR_PERSON,
  PERSON_MAGNITUDE_FLOOR,
  personMagnitude,
  type HappinessScore,
  type MomentInputs,
} from "@/lib/recap-moments";
import type { LifeEventSources } from "@/lib/recap-life-events";
import { yearPeriod } from "@/lib/recap";

// Covers the happiness signal (issue #174) — the percentile rule, the
// all-time baseline, and the collapsing of adjacent days. The first-time
// signals are `firstSeenInPeriodWithDates` over different tables and are
// covered by the foundation's own tests.

const period = yearPeriod(2025);

/** Empty inputs with `overrides` on top — logging began long before 2025,
 * so the warm-up never applies unless a test moves it. */
function inputsWith(overrides: Partial<MomentInputs>): MomentInputs {
  return {
    baseline: null,
    scores: [],
    firstCountries: [],
    firstGenres: [],
    firstCities: [],
    placesLoggedFrom: "2015-01-01",
    firstPeople: [],
    maxPersonDays: 0,
    peopleLoggedFrom: "2015-01-01",
    lifeSources: null,
    ...overrides,
  };
}

/** `count` filler days at `score`, starting well before the period so they
 * only ever act as baseline. */
function baseline(count: number, score = 80): HappinessScore[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
    happiness: score,
  }));
}

describe("happinessMoments", () => {
  it("emits nothing until there is enough history for percentiles to mean anything", () => {
    // 99 all-time scores, one of them extraordinary — still no moment,
    // because a 99th percentile over 99 days is just "the best of 99 days".
    const scores = [...baseline(98), { date: "2025-06-01", happiness: 100 }];
    expect(happinessMoments(scores, period)).toEqual([]);
  });

  it("emits a spike for a day at the top of the all-time distribution", () => {
    const scores = [...baseline(150), { date: "2025-06-01", happiness: 100 }];
    const moments = happinessMoments(scores, period);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      date: "2025-06-01",
      kind: "happiness-spike",
      detail: "100 / 100",
    });
  });

  it("emits a dip for a day at the bottom", () => {
    const scores = [...baseline(150), { date: "2025-06-01", happiness: 5 }];
    const moments = happinessMoments(scores, period);
    expect(moments[0]).toMatchObject({ kind: "happiness-dip", date: "2025-06-01" });
  });

  it("measures against all-time, so a weak year does not promote its own average days", () => {
    // The period's own best day is 60, well below the all-time norm of 80.
    // Scored against itself it would be a "spike"; against all time it is
    // nothing of the sort.
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 60 },
      { date: "2025-06-02", happiness: 58 },
    ];
    expect(happinessMoments(scores, period).some((m) => m.kind === "happiness-spike")).toBe(false);
  });

  it("collapses a run of adjacent qualifying days into its peak", () => {
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 99 },
      { date: "2025-06-02", happiness: 100 },
      { date: "2025-06-03", happiness: 99 },
    ];
    const moments = happinessMoments(scores, period);
    expect(moments).toHaveLength(1);
    expect(moments[0].date).toBe("2025-06-02");
  });

  it("keeps non-adjacent qualifying days as separate moments", () => {
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 100 },
      { date: "2025-09-01", happiness: 100 },
    ];
    expect(happinessMoments(scores, period)).toHaveLength(2);
  });

  it("does not merge a dip into an adjacent spike", () => {
    // The contrast is arguably the more interesting thing that happened.
    const scores = [
      ...baseline(150),
      { date: "2025-06-01", happiness: 100 },
      { date: "2025-06-02", happiness: 5 },
    ];
    const moments = happinessMoments(scores, period);
    expect(moments.map((m) => m.kind)).toEqual(["happiness-spike", "happiness-dip"]);
  });

  it("ignores qualifying days outside the period", () => {
    const scores = [...baseline(150), { date: "2024-06-01", happiness: 100 }];
    expect(happinessMoments(scores, period)).toEqual([]);
  });

  it("scores the most extreme day at full magnitude", () => {
    const scores = [...baseline(150), { date: "2025-06-01", happiness: 100 }];
    expect(happinessMoments(scores, period)[0].magnitude).toBeCloseTo(1);
  });
});

// #522 moved the engine onto narrow inputs — a summarised baseline and the
// earliest appearance per key instead of every row — so the year recap and
// "on this day" share one loader. These pin that the narrow shape gives the
// same answers as the full history did.
describe("narrow moment inputs", () => {
  it("scores against a baseline exactly as against the full history", () => {
    const scores = [
      ...baseline(150),
      ...baseline(30, 60),
      { date: "2025-06-01", happiness: 100 },
      { date: "2025-07-01", happiness: 5 },
    ];
    const inPeriod = scores.filter((s) => s.date.startsWith("2025"));
    expect(
      happinessMomentsFromBaseline(happinessBaseline(scores.map((s) => s.happiness)), inPeriod, period)
    ).toEqual(happinessMoments(scores, period));
  });

  it("keeps the 100-score floor when the baseline is summarised", () => {
    const scores = [...baseline(98), { date: "2025-06-01", happiness: 100 }];
    expect(
      happinessMomentsFromBaseline(happinessBaseline(scores.map((s) => s.happiness)), scores, period)
    ).toEqual([]);
  });

  it("finds first times from earliest-per-key appearances, ranked by magnitude", () => {
    const moments = buildRecapMoments(
      inputsWith({
        baseline: null,
        scores: [],
        firstCountries: [
          { key: "Japan", date: "2025-04-02" },
          { key: "France", date: "2019-08-01" },
        ],
        firstGenres: [{ key: "Horror", date: "2025-01-10" }],
      }),
      period
    );
    expect(moments.map((m) => m.headline)).toEqual(["First time in Japan", "First horror film"]);
  });
});

// The kinds added for "on this day" (#522).
describe("first day with a person", () => {
  it("ignores people logged on fewer than the minimum days", () => {
    const moments = buildRecapMoments(
      inputsWith({
        firstPeople: [
          { name: "Once", date: "2025-03-01", totalDays: MIN_DAYS_FOR_PERSON - 1 },
          { name: "Regular", date: "2025-03-02", totalDays: MIN_DAYS_FOR_PERSON },
        ],
        maxPersonDays: 500,
      }),
      period
    );
    expect(moments.map((m) => m.headline)).toEqual(["First day with Regular"]);
  });

  it("ranks people with tons of days highest — the most-logged person matches a best-ever day", () => {
    expect(personMagnitude(1500, 1500)).toBeCloseTo(1);
    expect(personMagnitude(MIN_DAYS_FOR_PERSON, 1500)).toBeCloseTo(PERSON_MAGNITUDE_FLOOR);
    // Log-scaled: a few hundred days sits well above someone met a dozen times,
    // and the latter falls below a first genre (0.4).
    expect(personMagnitude(300, 1500)).toBeGreaterThan(0.7);
    expect(personMagnitude(12, 1500)).toBeLessThan(0.4);
  });

  it("puts a heavily-logged person above a first country, a light one below", () => {
    const moments = buildRecapMoments(
      inputsWith({
        firstCountries: [{ key: "Japan", date: "2025-05-01" }],
        firstPeople: [
          { name: "Partner", date: "2025-02-01", totalDays: 1500 },
          { name: "Acquaintance", date: "2025-06-01", totalDays: 15 },
        ],
        maxPersonDays: 1500,
      }),
      period
    );
    expect(moments.map((m) => m.headline)).toEqual([
      "First day with Partner",
      "First time in Japan",
      "First day with Acquaintance",
    ]);
  });

  it("ignores firsts in the warm-up after people logging began", () => {
    const moments = buildRecapMoments(
      inputsWith({
        peopleLoggedFrom: "2025-01-01",
        firstPeople: [
          { name: "Parent", date: "2025-01-20", totalDays: 900 },
          { name: "New friend", date: "2025-06-01", totalDays: 40 },
        ],
        maxPersonDays: 900,
      }),
      period
    );
    expect(moments.map((m) => m.headline)).toEqual(["First day with New friend"]);
  });
});

describe("first time in a city", () => {
  it("is dropped when a first country lands the same day", () => {
    const moments = buildRecapMoments(
      inputsWith({
        firstCountries: [{ key: "Japan", date: "2025-05-01" }],
        firstCities: [
          { key: "Tokyo", date: "2025-05-01" },
          { key: "Osaka", date: "2025-05-04" },
        ],
      }),
      period
    );
    expect(moments.map((m) => m.headline)).toEqual(["First time in Japan", "First time in Osaka"]);
  });
});

describe("life starts", () => {
  const sources = {
    occupations: [
      {
        id: 1, name: "Acme", alias: null, type: "work", start: "2025-04-01", end: "2025-09-30",
        color: null, position: "Engineer", company: null, placeName: null, roles: [],
      },
    ],
    residences: [
      { id: 2, name: "Elm St", alias: null, start: "2020-01-01", end: "2025-07-01", color: null, placeName: null },
    ],
    relationships: [],
  } as unknown as LifeEventSources;

  it("reports starts only — an ending isn't resurfaced", () => {
    const moments = buildRecapMoments(inputsWith({ lifeSources: sources }), period);
    expect(moments.map((m) => [m.kind, m.headline, m.date])).toEqual([
      ["life-start", "Started at Acme", "2025-04-01"],
    ]);
  });

  it("is absent when life sources weren't loaded (the recap's own path)", () => {
    expect(buildRecapMoments(inputsWith({}), period)).toEqual([]);
  });
});
