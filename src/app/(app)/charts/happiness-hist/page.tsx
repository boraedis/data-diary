import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HistogramChart } from "@/components/charts/histogram-chart";
import { getHappinessHistogramData } from "@/lib/charts";
import { HIST_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { HAPPINESS_METHODOLOGY } from "@/lib/viz/methodology";

export const dynamic = "force-dynamic";

export default async function HappinessHistChartPage() {
  const values = await getHappinessHistogramData();

  return (
    <ChartPage
      title="Happiness histogram"
      description="The distribution of happiness ratings across every day logged."
      info={{ interactionGuide: HIST_INTERACTION_GUIDE, methodology: HAPPINESS_METHODOLOGY }}
    >
      <ChartCard empty={values.length === 0}>
        <HistogramChart values={values} />
      </ChartCard>
    </ChartPage>
  );
}
