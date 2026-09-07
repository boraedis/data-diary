import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { DistanceDailyChart } from "@/components/charts/distance-charts";
import { getDistanceScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function DistanceDailyChartPage() {
  const data = await getDistanceScrollerData();

  return (
    <ChartPage title="Daily distance walked">
      <ChartCard
        title="Daily distance walked"
        description="Every logged day. Scroll or drag to zoom, and use the strip below to move through the range."
        empty={data.length === 0}
      >
        <DistanceDailyChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
