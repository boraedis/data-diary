import { HappinessTrendChart } from "@/components/charts/happiness-trend-chart";
import { getHappinessTrendData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the split toggle and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function HappinessTrendChartPage() {
  const data = await getHappinessTrendData();
  return <HappinessTrendChart data={data} />;
}
