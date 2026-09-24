import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import {
  ENTERTAINMENT_MODES,
  entertainmentColumns,
  getEntertainmentLeaderboardData,
  TYPE_FILTERS,
  type EntertainmentMode,
  type TypeFilter,
} from "@/lib/leaderboards/entertainment";
import { pickOption, type LeaderboardPicker, type SearchParams } from "@/lib/leaderboards/options";
import { ENTERTAINMENT_METHODOLOGY } from "@/lib/viz/methodology";
import { ENTERTAINMENT_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<EntertainmentMode, string> = {
  type: "Time spent on each kind of entertainment.",
  title: "Every movie, show, book, league and game, ranked by time spent on it.",
  location: "Where I spend my entertainment time.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = pickOption(params.by, ENTERTAINMENT_MODES);
  const pickers: LeaderboardPicker[] = [{ param: "by", label: "Rank", value: mode, options: ENTERTAINMENT_MODES }];
  // Title and location both narrow to one type ("where do I watch
  // movies"); ranking types by type has nothing to narrow.
  let typeFilter: TypeFilter = "all";
  if (mode !== "type") {
    typeFilter = pickOption(params.type, TYPE_FILTERS);
    pickers.push({ param: "type", label: "Type", value: typeFilter, options: TYPE_FILTERS });
  }
  const rows = await getEntertainmentLeaderboardData(mode, typeFilter);
  return (
    <LeaderboardExplorer
      title="Entertainment Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={ENTERTAINMENT_METHODOLOGY}
      trackingSpan={ENTERTAINMENT_TRACKING_SPAN}
      pickers={pickers}
      rows={rows}
      columns={entertainmentColumns(mode)}
      ariaLabel="Entertainment ranked by time spent, with how each has moved over the last week, month and year."
    />
  );
}
