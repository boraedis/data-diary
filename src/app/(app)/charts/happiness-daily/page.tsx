import { HappinessScrollerChart } from "@/components/charts/happiness-scroller-chart";
import { getHappinessScrollerData, getProfileRegionGroups } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function HappinessDailyChartPage() {
  const [data, regionGroups] = await Promise.all([getHappinessScrollerData(), getProfileRegionGroups()]);

  return <HappinessScrollerChart data={data} regionGroups={regionGroups} />;
}
