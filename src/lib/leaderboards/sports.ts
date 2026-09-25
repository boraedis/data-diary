import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { sports, sportsLeagues, sportsTeams, sportsWatches } from "@/db/schema";
import { rankCreditedSessions, type Credit, type CreditedSession } from "@/lib/leaderboards/sessions";
import type { LeaderboardColumns, LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// The sports leaderboard (#115): hours of sport watched, ranked by sport,
// league, conference or team.

export type SportsMode = "sport" | "league" | "conference" | "team";

export const SPORTS_MODES: LeaderboardOption<SportsMode>[] = [
  { id: "sport", label: "Sports" },
  { id: "league", label: "Leagues" },
  { id: "conference", label: "Conferences" },
  { id: "team", label: "Teams" },
];

export type SportsTeam = {
  id: number;
  name: string;
  color: string | null;
  /** The team's conference/division, as the catalog stores it (ACC, NFC
   * North, Eastern). It's a per-team text field rather than a link to
   * `sports_divisions`, which most leagues' teams don't reference. */
  division: string | null;
  leagueId: number | null;
  league: string | null;
};

export type SportsWatch = {
  date: string;
  minutes: number;
  sportId: number;
  sport: string;
  leagueId: number | null;
  league: string | null;
  teams: SportsTeam[];
};

/**
 * Ranks watched sport by hours under one mode.
 *
 * A game credits **both** teams in full — watching Arsenal v Spurs is 90
 * minutes of each, not 45 — and likewise both teams' conferences, though
 * a game inside one conference counts once toward it
 * (`rankCreditedSessions` dedupes a session's repeated keys). A team or
 * conference is keyed by its league too, since "Eastern" is a conference
 * in more than one league.
 */
export function buildSportsLeaderboard(watches: SportsWatch[], mode: SportsMode): LeaderboardRow[] {
  const credited: CreditedSession[] = watches.map((w) => {
    const hours = w.minutes / 60;
    let credits: Credit[];
    switch (mode) {
      case "sport":
        credits = [{ key: String(w.sportId), name: w.sport }];
        break;
      case "league":
        credits =
          w.leagueId !== null ? [{ key: String(w.leagueId), name: w.league ?? "Unknown", detail: w.sport }] : [];
        break;
      case "conference":
        credits = w.teams
          .filter((t) => t.division)
          .map((t) => ({
            key: `${t.leagueId ?? "none"}:${t.division}`,
            name: t.division as string,
            detail: t.league,
          }));
        break;
      case "team":
        credits = w.teams.map((t) => ({ key: String(t.id), name: t.name, detail: t.league, color: t.color }));
        break;
    }
    return { date: w.date, hours, credits };
  });
  return rankCreditedSessions(credited);
}

export function sportsColumns(mode: SportsMode): LeaderboardColumns {
  const base = {
    valueHeader: "Time",
    valueDescription:
      mode === "team" || mode === "conference"
        ? "Hours of games watched involving them — a game counts in full toward both sides."
        : "Hours of games watched.",
    valueFormat: "hours" as const,
    countHeader: "Games",
    gainedNoun: "time gained",
  };
  const names: Record<SportsMode, string> = { sport: "Sport", league: "League", conference: "Conference", team: "Team" };
  return { ...base, nameHeader: names[mode] };
}

const homeTeams = alias(sportsTeams, "home_teams");
const awayTeams = alias(sportsTeams, "away_teams");
const homeLeagues = alias(sportsLeagues, "home_leagues");
const awayLeagues = alias(sportsLeagues, "away_leagues");

export async function getSportsLeaderboardData(mode: SportsMode): Promise<LeaderboardRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: sportsWatches.date,
      minutes: sportsWatches.durationMinutes,
      sportId: sports.id,
      sport: sports.name,
      leagueId: sportsLeagues.id,
      league: sportsLeagues.name,
      home: {
        id: homeTeams.id,
        name: homeTeams.name,
        color: homeTeams.color,
        division: homeTeams.division,
        leagueId: homeTeams.leagueId,
        league: homeLeagues.name,
      },
      away: {
        id: awayTeams.id,
        name: awayTeams.name,
        color: awayTeams.color,
        division: awayTeams.division,
        leagueId: awayTeams.leagueId,
        league: awayLeagues.name,
      },
    })
    .from(sportsWatches)
    .innerJoin(sports, eq(sportsWatches.sportId, sports.id))
    .leftJoin(sportsLeagues, eq(sportsWatches.leagueId, sportsLeagues.id))
    .leftJoin(homeTeams, eq(sportsWatches.homeTeamId, homeTeams.id))
    .leftJoin(homeLeagues, eq(homeTeams.leagueId, homeLeagues.id))
    .leftJoin(awayTeams, eq(sportsWatches.awayTeamId, awayTeams.id))
    .leftJoin(awayLeagues, eq(awayTeams.leagueId, awayLeagues.id));

  const watches: SportsWatch[] = rows.map((r) => ({
    date: r.date,
    minutes: r.minutes ?? 0,
    sportId: r.sportId,
    sport: r.sport,
    leagueId: r.leagueId,
    league: r.league,
    // Drizzle returns a left-joined nested object as null when every
    // column in it is null — i.e. no team in that slot.
    teams: [r.home, r.away].filter((t): t is SportsTeam => t !== null),
  }));
  return buildSportsLeaderboard(watches, mode);
}
