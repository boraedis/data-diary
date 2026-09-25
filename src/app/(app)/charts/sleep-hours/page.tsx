import { SleepHoursChart } from "@/components/charts/sleep-hours-chart";
import { getSleepNightsData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/sleep-daily does: the range slider and the chart share
// state, and only plain data can cross the server/client boundary.
export default async function Page() {
  const data = await getSleepNightsData();
  return <SleepHoursChart data={data} />;
}
