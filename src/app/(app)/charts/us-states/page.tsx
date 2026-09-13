import { UsStateVisitsChart } from "@/components/charts/us-state-visits-chart";
import { getUsCountyVisitData, getUsStateVisitData } from "@/lib/charts";
import { getUnloggedTravelCodes } from "@/lib/unlogged-travel";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight and /charts/life-timeline do: the view picker and
// the map share state, and only plain data can cross the server/client
// boundary. The page's own description changes with the selected view, so
// it can't be fixed text on a server component either.
export default async function UsStateVisitsChartPage() {
  // County data is fetched with the page rather than on first drill-in
  // (#107): it's a small payload (one row per county that has any days —
  // ~100), and the expensive half is the point-in-polygon join, which has
  // to happen server-side either way. Fetching it up front keeps the
  // drill-in itself down to loading geometry, with no second round trip.
  // Unlogged travel (#365) comes along in the same round trip. It's a
  // small query — codes only, no dates or notes, since the map's question
  // is purely membership — and it's needed by all three view modes and
  // the drill-down alike, so there's nothing to defer.
  const [data, counties, travelled] = await Promise.all([
    getUsStateVisitData(),
    getUsCountyVisitData(),
    getUnloggedTravelCodes("us_county"),
  ]);

  // Spread to an array at the boundary: a Set doesn't cross into a client
  // component as a prop, and the chart re-Sets it where the membership
  // tests happen.
  return <UsStateVisitsChart data={data} counties={counties} travelledCounties={[...travelled]} />;
}
