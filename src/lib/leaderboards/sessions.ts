import { computeRankings, STANDARD_RANK_WINDOWS, type RankAppearance } from "@/lib/ranking";
import { toLeaderboardRows, type LeaderboardMeta, type LeaderboardRow } from "@/lib/leaderboards/rows";

// The shared shape behind the entertainment, sports and exercise
// leaderboards (#115): a list of dated sessions, each worth some hours and
// credited to one or more keys under the current mode. A movie watch
// credits its title; a game watch credits both teams; a workout credits
// every focus its exercise trains.

export type Credit = { key: string } & LeaderboardMeta;

export type CreditedSession = {
  date: string;
  hours: number;
  credits: Credit[];
};

/**
 * Ranks keys by hours, with a session count alongside.
 *
 * A session crediting the same key twice (a derby between two teams in one
 * conference) counts once for it — the game was watched once, not twice.
 * Windows anchor on the latest session, so a gap in logging doesn't read
 * as every row standing still.
 */
export function rankCreditedSessions(sessions: CreditedSession[]): LeaderboardRow[] {
  const appearances: RankAppearance[] = [];
  const labels = new Map<string, LeaderboardMeta>();
  let asOf = "";
  for (const session of sessions) {
    if (session.date > asOf) asOf = session.date;
    const seen = new Set<string>();
    for (const credit of session.credits) {
      if (seen.has(credit.key)) continue;
      seen.add(credit.key);
      if (!labels.has(credit.key)) labels.set(credit.key, credit);
      appearances.push({ key: credit.key, date: session.date, weight: session.hours });
    }
  }
  if (appearances.length === 0) return [];
  const ranked = computeRankings(appearances, asOf, STANDARD_RANK_WINDOWS);
  return toLeaderboardRows(ranked, STANDARD_RANK_WINDOWS, (key) => labels.get(key) ?? { name: "Unknown" });
}
