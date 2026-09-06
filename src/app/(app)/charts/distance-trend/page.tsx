import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { MonthlyAverageChart } from "@/components/charts/monthly-average-chart";
import { getDistanceAveragerData } from "@/lib/charts";
import { categoricalColor } from "@/lib/viz/color";

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
        <MonthlyAverageChart
          data={data}
          seriesId="distance"
          label="Distance walked"
          color={categoricalColor(3)}
          valueFormat={(v) => `${v.toFixed(1)} km`}
          ariaLabel="Monthly average distance walked per day. Use arrow keys to inspect individual months, or hover a point."
        />
      </ChartCard>
    </ChartPage>
  );
}
