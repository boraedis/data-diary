import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { DistanceTrendChart } from "@/components/charts/distance-charts";
import { getDistanceAveragerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function DistanceTrendChartPage() {
  const data = await getDistanceAveragerData();

  return (
    <ChartPage title="Distance walked trend">
      <ChartCard
        title="Distance walked trend"
        description="Monthly average kilometres per day; marker size shows how many days fed each point, and the band shows that month's range."
        empty={data.length === 0}
      >
        <DistanceTrendChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
