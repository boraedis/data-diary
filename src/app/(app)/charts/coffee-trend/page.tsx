import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CoffeeTrendChart } from "@/components/charts/coffee-charts";
import { getCoffeeAveragerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function CoffeeTrendChartPage() {
  const data = await getCoffeeAveragerData();

  return (
    <ChartPage title="Coffee trend">
      <ChartCard
        title="Coffee trend"
        description="Monthly average cups per day; marker size shows how many days fed each point, and the band shows that month's range."
        empty={data.length === 0}
      >
        <CoffeeTrendChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
