import { describe, expect, it } from "vitest";
import { yearPeriod } from "@/lib/recap";
import { buildGamePicks, buildSportsPicks, toRecapPicks } from "@/lib/recap-entertainment";
import type { EntertainmentSession } from "@/lib/leaderboards/entertainment";
import type { LeaderboardRow } from "@/lib/leaderboards/rows";
import type { SportsWatch } from "@/lib/leaderboards/sports";

// Covers the recap's top-picks rules (#528): period scoping, the top-N
// cut that keeps ties whole, movement being stripped, and the sports
// team → league fallback. The SQL behind songs/podcasts is a plain
// aggregate over the same fragments as the music page.

const period = yearPeriod(2025);

function game(date: string, title: string, minutes: number): EntertainmentSession {
  return {
    date,
    minutes,
    type: "game",
    typeLabel: "Game",
    titleKey: `game:${title}`,
    title,
    titleDetail: null,
    location: null,
  };
}

function row(rank: number, name: string): LeaderboardRow {
  return {
    key: name,
    rank,
    name,
    detail: null,
    context: null,
    color: null,
    value: 10 - rank,
    count: 1,
    previousRanks: [1],
    gained: [1],
  };
}

describe("toRecapPicks", () => {
  it("returns nothing for an empty list", () => {
    expect(toRecapPicks([])).toEqual([]);
  });

  it("cuts to the top five by rank and drops movement", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((name, i) => row(i + 1, name));
    const picks = toRecapPicks(rows);
    expect(picks.map((r) => r.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(picks.every((r) => r.previousRanks === null && r.gained === null)).toBe(true);
  });

  it("keeps a tie at the boundary whole", () => {
    const rows = [row(1, "a"), row(2, "b"), row(3, "c"), row(4, "d"), row(5, "e"), row(5, "f"), row(7, "g")];
    expect(toRecapPicks(rows).map((r) => r.name)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("buildGamePicks", () => {
  it("ranks titles by time inside the period only", () => {
    const picks = buildGamePicks(
      [
        game("2025-03-01", "Celeste", 120),
        game("2025-03-02", "Celeste", 60),
        game("2025-04-01", "Hades", 100),
        game("2024-12-31", "Outer Wilds", 9999),
        game("2026-01-01", "Outer Wilds", 9999),
      ],
      period,
    );
    expect(picks.map((r) => [r.name, r.count])).toEqual([
      ["Celeste", 2],
      ["Hades", 1],
    ]);
    expect(picks[0].value).toBeCloseTo(3);
  });

  it("is empty when no game was played in the period", () => {
    expect(buildGamePicks([game("2024-05-01", "Celeste", 60)], period)).toEqual([]);
  });
});

describe("buildSportsPicks", () => {
  const team = { id: 1, name: "Arsenal", color: null, division: null, leagueId: 7, league: "Premier League" };
  const watch = (date: string, teams: SportsWatch["teams"]): SportsWatch => ({
    date,
    minutes: 90,
    sportId: 1,
    sport: "Soccer",
    leagueId: 7,
    league: "Premier League",
    teams,
  });

  it("ranks teams when any were logged", () => {
    const result = buildSportsPicks([watch("2025-02-01", [team])], period);
    expect(result.mode).toBe("team");
    expect(result.rows.map((r) => r.name)).toEqual(["Arsenal"]);
  });

  it("falls back to leagues when no team was logged", () => {
    const result = buildSportsPicks([watch("2025-02-01", [])], period);
    expect(result.mode).toBe("league");
    expect(result.rows.map((r) => r.name)).toEqual(["Premier League"]);
  });
});
