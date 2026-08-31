import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HistogramChart } from "@/components/charts/histogram-chart";
import { getHappinessHistogramData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function HappinessChartPage() {
  const values = await getHappinessHistogramData();

  return (
    <ChartPage title="Happiness distribution">
      <ChartCard
        title="Happiness distribution"
        description={`${values.length} day${values.length === 1 ? "" : "s"} logged, bucketed in 10-point ranges.`}
        empty={values.length === 0}
      >
        <HistogramChart values={values} />
      </ChartCard>
    </ChartPage>
  );
}
