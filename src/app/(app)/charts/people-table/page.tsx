import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { getPeopleDailyData } from "@/lib/charts";
import { pickOption, type SearchParams } from "@/lib/leaderboards/options";
import { buildPeopleLeaderboard, PEOPLE_MODES, peopleColumns, type PeopleMode } from "@/lib/leaderboards/people";
import { PEOPLE_IMPACT_METHODOLOGY, PEOPLE_METHODOLOGY } from "@/lib/viz/methodology";
import { PEOPLE_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<PeopleMode, string> = {
  mentions: "The people I've logged the most, and how the ranking has moved over the last week, month and year.",
  impact: "Who contributed most to how my days went, by the legacy impact score summed across every day.",
  "tag-mentions": "Which groups of people fill my days — every tagged person on every day counts.",
  "tag-impact": "Which groups of people contributed most to how my days went.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = pickOption(params.by, PEOPLE_MODES);
  const rows = buildPeopleLeaderboard(await getPeopleDailyData(), mode);
  const impact = mode === "impact" || mode === "tag-impact";
  return (
    <LeaderboardExplorer
      title="People Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={impact ? PEOPLE_IMPACT_METHODOLOGY : PEOPLE_METHODOLOGY}
      trackingSpan={PEOPLE_TRACKING_SPAN}
      pickers={[{ param: "by", label: "Rank", value: mode, options: PEOPLE_MODES }]}
      rows={rows}
      columns={peopleColumns(mode)}
      ariaLabel="People ranked, with how each has moved over the last week, month and year."
    />
  );
}
