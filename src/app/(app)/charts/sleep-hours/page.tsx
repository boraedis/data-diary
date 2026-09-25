import { SleepHoursChart } from "@/components/charts/sleep-hours-chart";
import { getProfileRegionGroups, getSleepNightsData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/sleep-daily does: the pickers and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function Page() {
  const [data, regionGroups] = await Promise.all([getSleepNightsData(), getProfileRegionGroups()]);
  return <SleepHoursChart data={data} regionGroups={regionGroups} />;
}
