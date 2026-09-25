import { PeopleImpactTrendChart } from "@/components/charts/people-impact-trend-chart";
import { getPeopleDailyData, getPeopleNicknames } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the filters row and the chart share state,
// and only plain data can cross the server/client boundary.
//
// The route keeps its old /people-over-time path from when this was the
// "People Trend" area chart, so existing links and favourites still land.
export default async function Page() {
  const [data, nicknames] = await Promise.all([getPeopleDailyData(), getPeopleNicknames()]);
  return <PeopleImpactTrendChart data={data} nicknames={nicknames} />;
}
