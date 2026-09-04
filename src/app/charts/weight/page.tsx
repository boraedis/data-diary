import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getWeightScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function WeightChartPage() {
  const data = await getWeightScrollerData();

  return (
    <ChartPage title="Weight over time">
      <ChartCard
        title="Weight over time"
        description="Scroll or drag on the chart to zoom, or drag the strip below it; double-click to reset."
        empty={data.length === 0}
      >
        <WeightScrollerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
