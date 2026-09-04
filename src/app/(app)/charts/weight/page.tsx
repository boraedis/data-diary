import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getProfileRegionGroups, getWeightScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function WeightChartPage() {
  const [data, regionGroups] = await Promise.all([getWeightScrollerData(), getProfileRegionGroups()]);

  return <WeightScrollerChart data={data} regionGroups={regionGroups} />;
}
