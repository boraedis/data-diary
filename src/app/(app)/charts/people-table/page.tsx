import { PeopleTableChart } from "@/components/charts/people-charts";
import { getPeopleDailyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the filters row and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function Page() {
  const data = await getPeopleDailyData();
  return <PeopleTableChart data={data} />;
}
