import { HappinessHistChart } from "@/components/charts/histogram-chart";
import { getHappinessHistogramData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the filters row and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function HappinessHistChartPage() {
  const data = await getHappinessHistogramData();
  return <HappinessHistChart data={data} />;
}
