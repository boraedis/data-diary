import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { pickOption, type LeaderboardPicker, type SearchParams } from "@/lib/leaderboards/options";
import {
  CATEGORY_LEVELS,
  getPlaceLeaderboardData,
  PLACE_MODES,
  placeColumns,
  REGION_LEVELS,
  type PlaceLeaderboardOptions,
} from "@/lib/leaderboards/places";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<PlaceLeaderboardOptions["mode"], string> = {
  place: "My most mentioned locations, and how each one's standing has moved over the last week, month and year.",
  region: "Days rolled up into the region they sit in — every place in a neighborhood counts toward it.",
  metro: "Days rolled up by metro area — everything inside a city and its surroundings counts toward it.",
  category: "Days grouped by what kind of place it is.",
};

// The mode lives in the URL (`?by=region&level=Neighborhood`) so the server
// ranks only the view on screen — see LeaderboardExplorer.
export default async function PlacesChartPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = pickOption(params.by, PLACE_MODES);
  const pickers: LeaderboardPicker[] = [{ param: "by", label: "Rank", value: mode, options: PLACE_MODES }];

  let options: PlaceLeaderboardOptions;
  if (mode === "region") {
    const level = pickOption(params.level, REGION_LEVELS);
    pickers.push({ param: "level", label: "Level", value: level, options: REGION_LEVELS });
    options = { mode, level };
  } else if (mode === "category") {
    const level = pickOption(params.level, CATEGORY_LEVELS);
    pickers.push({ param: "level", label: "Level", value: level, options: CATEGORY_LEVELS });
    options = { mode, level };
  } else {
    options = { mode };
  }

  const rows = await getPlaceLeaderboardData(options);
  return (
    <LeaderboardExplorer
      title="Place Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={PLACES_METHODOLOGY}
      trackingSpan={PLACES_TRACKING_SPAN}
      pickers={pickers}
      rows={rows}
      columns={placeColumns(options)}
      ariaLabel="Places ranked by days spent there, with how each has moved over the last week, month and year."
    />
  );
}
