import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CoffeeCalendarChart } from "@/components/charts/coffee-charts";
import { getCoffeeCalendarData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function CoffeeCalendarChartPage() {
  const data = await getCoffeeCalendarData();

  return (
    <ChartPage title="Coffee calendar">
      <ChartCard
        title="Coffee calendar"
        description="A year-by-year heatmap of cups per day. Hover a day for the exact count."
        empty={data.length === 0}
      >
        <CoffeeCalendarChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
