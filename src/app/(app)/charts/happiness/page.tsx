import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HistogramChart } from "@/components/charts/histogram-chart";
import { getHappinessHistogramData } from "@/lib/charts";
import { HIST_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const dynamic = "force-dynamic";

export default async function HappinessChartPage() {
  const values = await getHappinessHistogramData();

  return (
    <ChartPage
      title="Happiness distribution"
      description={`${values.length} day${values.length === 1 ? "" : "s"} logged, one bar per point.`}
      info={{ interactionGuide: HIST_INTERACTION_GUIDE }}
    >
      <ChartCard fillHeight empty={values.length === 0}>
        <HistogramChart values={values} />
      </ChartCard>
    </ChartPage>
  );
}
