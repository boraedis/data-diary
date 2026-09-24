import { describe, expect, it } from "vitest";
import type { PeopleDay } from "@/lib/charts";
import { personImpact } from "@/lib/impact";
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

  it("counts one mention per day and shows the latest tag", () => {
    const rows = buildPeopleLeaderboard(data, "mentions");
    expect(byName(rows)).toEqual([
      ["Ana", 2],
      ["Ben", 1],
      ["Cy", 1],
    ]);
    expect(rows[0]).toMatchObject({ context: "Friends", color: "#abcdef" });
    expect(rows[2]).toMatchObject({ context: null, color: null });
  });

  it("sums impact, skipping days with no happiness score", () => {
    const rows = buildPeopleLeaderboard(data, "impact");
    const ana = rows.find((r) => r.name === "Ana")!;
    expect(ana.value).toBeCloseTo(personImpact(80, 1), 2);
    expect(ana.count).toBe(1);
  });

  it("groups person-mentions by tag, with untagged people together", () => {
    expect(byName(buildPeopleLeaderboard(data, "tag-mentions"))).toEqual([
      ["Friends", 3],
      ["Untagged", 1],
    ]);
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
    [1, ["Cardio", "Back"]],
    [2, ["Chest"]],
  ]);

  it("credits every focus an exercise trains in full", () => {
    expect(byName(buildExerciseLeaderboard(workouts, focuses, "focus"))).toEqual([
      ["Cardio", 1],
      ["Back", 1],
      ["Chest", 0.5],
    ]);
  });

  it("ranks categories by their labels", () => {
    const rows = buildExerciseLeaderboard(workouts, focuses, "category");
    expect(rows.map((r) => r.key)).toEqual(["distance", "strength"]);
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
