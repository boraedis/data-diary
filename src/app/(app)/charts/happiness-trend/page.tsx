import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HappinessAveragerChart } from "@/components/charts/happiness-averager-chart";
import { getHappinessAveragerData } from "@/lib/charts";
import { LINE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { HAPPINESS_METHODOLOGY } from "@/lib/viz/methodology";

export const dynamic = "force-dynamic";

export default async function HappinessTrendChartPage() {
  const data = await getHappinessAveragerData();

  return (
    <ChartPage
      title="Happiness Trend"
      description="Trend in happiness over time, aggregated by period."
      info={{ interactionGuide: LINE_INTERACTION_GUIDE, methodology: HAPPINESS_METHODOLOGY }}
    >
      <ChartCard empty={data.length === 0}>
        <HappinessAveragerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
