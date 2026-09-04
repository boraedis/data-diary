import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getWeightChartRegions, getWeightScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function WeightChartPage() {
  const [data, regionGroups] = await Promise.all([getWeightScrollerData(), getWeightChartRegions()]);

  return <WeightScrollerChart data={data} regionGroups={regionGroups} />;
}
