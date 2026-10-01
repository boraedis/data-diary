import { EntertainmentMixExplorer } from "@/components/charts/entertainment-mix-explorer";
import { getEntertainmentDailyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// Same daily series as /charts/entertainment-trend; the explorer owns the
// page shell because its pickers and the chart share state.
export default async function Page() {
  const data = await getEntertainmentDailyData();
  return <EntertainmentMixExplorer data={data} />;
}
