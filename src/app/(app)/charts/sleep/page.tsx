import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getSleepNightsData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the naps toggle and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function SleepChartPage() {
  const data = await getSleepNightsData();
  return <SleepCalendarChart data={data} />;
}
