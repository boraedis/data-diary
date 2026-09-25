import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { pickOption, type SearchParams } from "@/lib/leaderboards/options";
import { getSportsLeaderboardData, SPORTS_MODES, sportsColumns, type SportsMode } from "@/lib/leaderboards/sports";
import { SPORTS_METHODOLOGY } from "@/lib/viz/methodology";
import { SPORTS_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<SportsMode, string> = {
  sport: "The sports I watch most, by time watched.",
  league: "The leagues I watch most, by time watched.",
  conference: "Conferences and divisions by time watched — a game counts toward both teams' conferences.",
  team: "The teams I watch most — a game counts in full toward both sides.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const mode = pickOption((await searchParams).by, SPORTS_MODES);
  const rows = await getSportsLeaderboardData(mode);
  return (
    <LeaderboardExplorer
      title="Sports Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={SPORTS_METHODOLOGY}
      trackingSpan={SPORTS_TRACKING_SPAN}
      pickers={[{ param: "by", label: "Rank", value: mode, options: SPORTS_MODES }]}
      rows={rows}
      columns={sportsColumns(mode)}
      ariaLabel="Sports ranked by time watched, with how each has moved over the last week, month and year."
    />
  );
}
