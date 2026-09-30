import { PeopleTreemapChart } from "@/components/charts/people-treemap-chart";
import { getPeopleDailyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/people-calendar does: the filters row and the chart share
// state, and only plain data can cross the server/client boundary.
export default async function Page() {
  const data = await getPeopleDailyData();
  return <PeopleTreemapChart data={data} />;
}
