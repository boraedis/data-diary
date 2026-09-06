import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { MonthlyAverageChart } from "@/components/charts/monthly-average-chart";
import { getCoffeeAveragerData } from "@/lib/charts";
import { categoricalColor } from "@/lib/viz/color";

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
        <MonthlyAverageChart
          data={data}
          seriesId="coffee"
          label="Coffee"
          color={categoricalColor(0)}
          valueFormat={(v) => v.toFixed(1)}
          ariaLabel="Monthly average cups of coffee per day. Use arrow keys to inspect individual months, or hover a point."
        />
      </ChartCard>
    </ChartPage>
  );
}
