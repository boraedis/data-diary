import { PeopleRaceChart } from "@/components/charts/people-charts";
import { getPeopleDailyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// Same shape as /charts/people-over-time: the chart component owns the page
// shell, and the server component's only job is the query. Both read the
// identical raw rows — the race's own scoring (impact x recency) happens
// client-side, see PeopleRaceChart.
export default async function Page() {
  const data = await getPeopleDailyData();
  return <PeopleRaceChart data={data} />;
}
