import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HappinessAveragerChart } from "@/components/charts/happiness-averager-chart";
import { getHappinessAveragerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function HappinessTrendChartPage() {
  const data = await getHappinessAveragerData();

  return (
    <ChartPage title="Happiness trend">
      <ChartCard
        title="Happiness trend"
        description="Monthly average, marker size shows how many days fed each point; shaded band shows that month's day-to-day range."
        empty={data.length === 0}
      >
        <HappinessAveragerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
