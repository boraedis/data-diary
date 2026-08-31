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
        description="Drag on the strip below the chart to zoom into a range; click to reset."
        empty={data.length === 0}
      >
        <WeightScrollerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
