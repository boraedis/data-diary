import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { getPeopleDailyData } from "@/lib/charts";
import { pickOption, type SearchParams } from "@/lib/leaderboards/options";
import { buildPeopleLeaderboard, PEOPLE_MODES, peopleColumns, type PeopleMode } from "@/lib/leaderboards/people";
import { PEOPLE_IMPACT_METHODOLOGY } from "@/lib/viz/methodology";
import { PEOPLE_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<PeopleMode, string> = {
  people:
    "Who matters most right now, by impact score faded for recency — sort by Days for who I've logged most. Movement shows how the ranking has shifted over the last week, month and year.",
  tags: "Which groups of people matter most right now, by the same recency-faded impact score — sort by Mentions for who fills the most days.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const mode = pickOption((await searchParams).by, PEOPLE_MODES);
  const rows = buildPeopleLeaderboard(await getPeopleDailyData(), mode);
  return (
    <LeaderboardExplorer
      title="People Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={PEOPLE_IMPACT_METHODOLOGY}
      trackingSpan={PEOPLE_TRACKING_SPAN}
      pickers={[{ param: "by", label: "Rank", value: mode, options: PEOPLE_MODES }]}
      rows={rows}
      columns={peopleColumns(mode)}
      ariaLabel="People ranked by recency-faded impact, with days logged and how each has moved over the last week, month and year."
    />
  );
}
