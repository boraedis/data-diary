import { describe, expect, it } from "vitest";
import type { PeopleDay } from "@/lib/charts";
import { personImpact, recencyWeight } from "@/lib/impact";
import { buildPeopleLeaderboard } from "@/lib/leaderboards/people";
import { buildEntertainmentLeaderboard, type EntertainmentSession } from "@/lib/leaderboards/entertainment";
import { buildSportsLeaderboard, type SportsWatch } from "@/lib/leaderboards/sports";
import { buildExerciseLeaderboard } from "@/lib/leaderboards/exercise";
import { movementOf } from "@/lib/leaderboards/rows";
import { rankSnapshots, STANDARD_RANK_WINDOWS } from "@/lib/ranking";
import type { ExerciseWorkoutRow } from "@/lib/charts";

// The crediting rules behind each leaderboard (#115) — who a session,
// mention or listen counts toward under each mode. Ranking and movement
// themselves are pinned in ranking.test.ts.

const byName = (rows: { name: string; value: number }[]) => rows.map((r) => [r.name, r.value]);

describe("buildPeopleLeaderboard", () => {
  const person = (name: string, slot: number, tagName: string | null = "Friends") => ({
    name,
    slot,
    tagName,
    tagColor: tagName ? "#abcdef" : null,
  });
  const data: PeopleDay[] = [
    { date: "2026-01-01", happiness: 80, people: [person("Ana", 1), person("Ben", 2)] },
    { date: "2026-01-02", happiness: null, people: [person("Ana", 1)] },
    { date: "2026-01-03", happiness: 40, people: [person("Cy", 1, null)] },
  ];

  it("ranks by recency-faded impact, skipping unscored days", () => {
    const rows = buildPeopleLeaderboard(data, "people");
    const ana = rows.find((r) => r.name === "Ana")!;
    // Ana's one scored day was two days before the latest logged day.
    expect(ana.value).toBeCloseTo(personImpact(80, 1) * recencyWeight(2), 2);
    const cy = rows.find((r) => r.name === "Cy")!;
    expect(cy.value).toBeCloseTo(personImpact(40, 1), 2);
  });

  it("counts every logged day as a mention, scored or not", () => {
    const rows = buildPeopleLeaderboard(data, "people");
    expect(rows.find((r) => r.name === "Ana")!.count).toBe(2);
    expect(rows.find((r) => r.name === "Ana")).toMatchObject({ context: "Friends", color: "#abcdef" });
    expect(rows.find((r) => r.name === "Cy")).toMatchObject({ context: null, color: null });
  });

  it("fades an old score so a recent one can overtake it", () => {
    // Old: a big score two years ago. New: a smaller one yesterday. Faded,
    // the recent day wins — the "who matters now" reading.
    const faded = buildPeopleLeaderboard(
      [
        { date: "2024-01-01", happiness: 0, people: [person("Old", 1)] },
        { date: "2026-01-01", happiness: 100, people: [person("New", 1)] },
      ],
      "people",
    );
    expect(personImpact(0, 1)).toBeGreaterThan(personImpact(100, 1));
    expect(faded.map((r) => r.name)).toEqual(["New", "Old"]);
    // A year ago only Old was ranked, so New is new and Old slipped.
    const old = faded.find((r) => r.name === "Old")!;
    expect(old.previousRanks![2]).toBe(1);
    expect(old.gained![2]).toBeLessThan(0);
  });

  it("groups by tag, summing person-days, with untagged people together", () => {
    const rows = buildPeopleLeaderboard(data, "tags");
    expect(rows.map((r) => [r.name, r.count])).toEqual(
      expect.arrayContaining([
        ["Friends", 3],
        ["Untagged", 1],
      ]),
    );
  });
});

describe("buildEntertainmentLeaderboard", () => {
  const session = (over: Partial<EntertainmentSession>): EntertainmentSession => ({
    date: "2026-01-01",
    minutes: 60,
    type: "movie",
    typeLabel: "Movies",
    titleKey: "movie:1",
    title: "Heat",
    titleDetail: "1995",
    location: "Home",
    ...over,
  });
  const sessions = [
    session({}),
    session({ type: "tv", typeLabel: "TV", titleKey: "tv:1", title: "Lost", minutes: 45, location: null }),
    session({ type: "tv", typeLabel: "TV", titleKey: "tv:1", title: "Lost", minutes: 45, location: "Bar" }),
    session({ type: "other", typeLabel: "Concert", titleKey: "entry:1", title: "Tour", minutes: 120, location: "Stadium" }),
  ];

  it("ranks types, with each user-added kind under its own name", () => {
    expect(byName(buildEntertainmentLeaderboard(sessions, "type", "all"))).toEqual([
      ["Concert", 2],
      ["TV", 1.5],
      ["Movies", 1],
    ]);
  });

  it("ranks titles within a type filter", () => {
    const rows = buildEntertainmentLeaderboard(sessions, "title", "tv");
    expect(byName(rows)).toEqual([["Lost", 1.5]]);
    expect(rows[0]).toMatchObject({ context: "TV", count: 2 });
  });

  it("ranks locations, folding a missing one into Unknown", () => {
    expect(byName(buildEntertainmentLeaderboard(sessions, "location", "tv"))).toEqual([
      ["Unknown", 0.75],
      ["Bar", 0.75],
    ]);
  });
});

describe("buildSportsLeaderboard", () => {
  const team = (id: number, name: string, division: string | null) => ({
    id,
    name,
    color: null,
    division,
    leagueId: 1,
    league: "NFL",
  });
  const watches: SportsWatch[] = [
    {
      date: "2026-01-01",
      minutes: 180,
      sportId: 1,
      sport: "American Football",
      leagueId: 1,
      league: "NFL",
      teams: [team(1, "Falcons", "NFC South"), team(2, "Saints", "NFC South")],
    },
    {
      date: "2026-01-02",
      minutes: 60,
      sportId: 1,
      sport: "American Football",
      leagueId: 1,
      league: "NFL",
      teams: [team(1, "Falcons", "NFC South"), team(3, "Bears", "NFC North")],
    },
  ];

  it("credits both teams in full", () => {
    expect(byName(buildSportsLeaderboard(watches, "team"))).toEqual([
      ["Falcons", 4],
      ["Saints", 3],
      ["Bears", 1],
    ]);
  });

  it("counts a game inside one conference once toward it", () => {
    const rows = buildSportsLeaderboard(watches, "conference");
    expect(byName(rows)).toEqual([
      ["NFC South", 4],
      ["NFC North", 1],
    ]);
    expect(rows[0].count).toBe(2);
  });
});

describe("buildExerciseLeaderboard", () => {
  const workout = (exerciseId: number, exerciseName: string, category: string, hours: number): ExerciseWorkoutRow => ({
    date: "2026-01-01",
    category,
    exerciseId,
    exerciseName,
    subtype: null,
    hours,
  });
  const workouts = [workout(1, "Rowing", "distance", 1), workout(2, "Bench", "strength", 0.5)];
  const focuses = new Map([
    [
      1,
      [
        { focus: "Cardio", subfocus: "Endurance" },
        { focus: "Strength", subfocus: "Back" },
      ],
    ],
    [2, [{ focus: "Strength", subfocus: "Chest" }]],
  ]);

  it("credits every focus an exercise trains in full", () => {
    expect(byName(buildExerciseLeaderboard(workouts, focuses, "focus"))).toEqual([
      ["Strength", 1.5],
      ["Cardio", 1],
    ]);
  });

  it("ranks subfocuses, labelled with their focus", () => {
    const rows = buildExerciseLeaderboard(workouts, focuses, "focus", "subfocus");
    expect(rows.map((r) => [r.name, r.detail, r.value])).toEqual([
      ["Endurance", "Cardio", 1],
      ["Back", "Strength", 1],
      ["Chest", "Strength", 0.5],
    ]);
  });

  it("ranks categories in their fixed colours", () => {
    const rows = buildExerciseLeaderboard(workouts, focuses, "category");
    expect(rows.map((r) => [r.key, r.color])).toEqual([
      ["distance", "var(--chart-1)"],
      ["strength", "var(--exercise-strength)"],
    ]);
  });
});

describe("rankSnapshots + movementOf", () => {
  it("rebuilds movement from the compact previous-rank list", () => {
    const [a, b] = rankSnapshots(
      [
        { key: "a", total: 10, occurrences: 5, before: { week: 2, month: null, year: null } },
        { key: "b", total: 4, occurrences: 2, before: { week: 3, month: 1, year: null } },
      ],
      STANDARD_RANK_WINDOWS,
    );
    expect(a.movements.week).toEqual({ delta: 1, isNew: false, previousRank: 2 });
    expect(b.movements.week).toEqual({ delta: -1, isNew: false, previousRank: 1 });
    expect(a.movements.month.isNew).toBe(true);

    const row = {
      key: "a",
      rank: 1,
      name: "a",
      detail: null,
      context: null,
      color: null,
      value: 10,
      count: 5,
      previousRanks: [2, null, null],
      gained: [8, 10, 10],
    };
    expect(movementOf(row, 0)).toEqual(a.movements.week);
    expect(movementOf(row, 1)).toEqual({ delta: null, isNew: true, previousRank: null });
  });
});
