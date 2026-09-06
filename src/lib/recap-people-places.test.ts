import { describe, expect, it } from "vitest";
import { buildRecapPeoplePlaces, type RecapPeoplePlacesInput } from "@/lib/recap-people-places";
import { previousPeriod, yearPeriod } from "@/lib/recap";

// Covers the fold that produces the whole people & places section (issue
// #172): distinct-day person counting, the legacy slot weighting, the
// first-appearance rule and per-day country dedup. The queries feeding it
// are plain reads; see the PR for how those were verified.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

function input(days: RecapPeoplePlacesInput["days"]): RecapPeoplePlacesInput {
  return {
    days,
    personNames: new Map([
      [1, "Ana"],
      [2, "Ben"],
      [3, "Cal"],
    ]),
    placeNames: new Map([
      [10, "Home"],
      [11, "Office"],
      [12, "Lisbon Airport"],
    ]),
    countryByPlaceId: new Map([
      [10, "United States"],
      [11, "United States"],
      [12, "Portugal"],
    ]),
    colorByPlaceId: new Map([[10, "#abcdef"]]),
  };
}

describe("buildRecapPeoplePlaces — people", () => {
  it("ranks the most-logged person by distinct days, not slot mentions", () => {
    // Ana fills two slots on one day; that's one day together, not two.
    const result = buildRecapPeoplePlaces(
      input([
        { date: "2025-03-01", personIds: [1, 1], placeIds: [] },
        { date: "2025-03-02", personIds: [2], placeIds: [] },
        { date: "2025-03-03", personIds: [2], placeIds: [] },
      ]),
      period,
      prior
    );
    expect(result.topPerson).toEqual({ name: "Ben", days: 2, priorDays: null });
  });

  it("compares the named person against their own prior-period count", () => {
    const result = buildRecapPeoplePlaces(
      input([
        { date: "2024-05-01", personIds: [1], placeIds: [] },
        { date: "2024-05-02", personIds: [1], placeIds: [] },
        { date: "2025-05-01", personIds: [1], placeIds: [] },
      ]),
      period,
      prior
    );
    expect(result.topPerson).toEqual({ name: "Ana", days: 1, priorDays: 2 });
  });

  it("has no top person when nobody was logged in the period", () => {
    const result = buildRecapPeoplePlaces(
      input([{ date: "2024-05-01", personIds: [1], placeIds: [] }]),
      period,
      prior
    );
    expect(result.topPerson).toBeNull();
  });

  it("counts someone as newly met only if they never appeared before the period", () => {
    const result = buildRecapPeoplePlaces(
      input([
        { date: "2019-01-01", personIds: [1], placeIds: [] },
        { date: "2025-01-05", personIds: [1, 2], placeIds: [] },
      ]),
      period,
      prior
    );
    expect(result.newPeople.total).toBe(1);
    expect(result.newPeople.examples).toEqual(["Ben"]);
  });
});

describe("buildRecapPeoplePlaces — places", () => {
  it("weights the first place slot double the second, matching the legacy leaderboard", () => {
    const result = buildRecapPeoplePlaces(
      input([
        { date: "2025-02-01", personIds: [], placeIds: [10, 11] },
        { date: "2025-02-02", personIds: [], placeIds: [11] },
      ]),
      period,
      prior
    );
    // Home: 2 (one first slot). Office: 1 (second slot) + 2 (first slot) = 3.
    expect(result.leaderboard).toEqual([
      { name: "Office", value: 3, color: null },
      { name: "Home", value: 2, color: "#abcdef" },
    ]);
  });

  it("excludes days outside the period from the leaderboard", () => {
    const result = buildRecapPeoplePlaces(
      input([{ date: "2024-02-01", personIds: [], placeIds: [10] }]),
      period,
      prior
    );
    expect(result.leaderboard).toEqual([]);
  });

  it("counts a country once per day even when both slots are in it", () => {
    const result = buildRecapPeoplePlaces(
      input([
        { date: "2025-06-01", personIds: [], placeIds: [10, 11] },
        { date: "2025-06-02", personIds: [], placeIds: [12] },
      ]),
      period,
      prior
    );
    expect(result.countryVisits).toEqual([
      { country: "United States", days: 1 },
      { country: "Portugal", days: 1 },
    ]);
  });

  it("treats a country as new only on its first-ever visit", () => {
    const result = buildRecapPeoplePlaces(
      input([
        { date: "2018-08-01", personIds: [], placeIds: [12] },
        { date: "2025-08-01", personIds: [], placeIds: [12] },
        { date: "2025-08-02", personIds: [], placeIds: [10] },
      ]),
      period,
      prior
    );
    // Portugal was already visited in 2018; only the US is new in 2025.
    expect(result.newCountries.examples).toEqual(["United States"]);
    expect(result.countriesVisited.total).toBe(2);
  });

  it("reports zero travel without breaking", () => {
    const result = buildRecapPeoplePlaces(
      input([{ date: "2025-01-01", personIds: [1], placeIds: [] }]),
      period,
      prior
    );
    expect(result.countryVisits).toEqual([]);
    expect(result.leaderboard).toEqual([]);
    expect(result.countriesVisited).toEqual({ total: 0, priorTotal: 0 });
    expect(result.newCountries.total).toBe(0);
  });
});
