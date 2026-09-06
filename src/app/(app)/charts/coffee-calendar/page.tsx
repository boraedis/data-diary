import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { DailyValueCalendar } from "@/components/charts/daily-value-calendar";
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
        <DailyValueCalendar
          data={data}
          formatValue={(cups) => `${cups} cup${cups === 1 ? "" : "s"}`}
          valueLabel="coffee"
          ariaLabel="Coffee calendar heatmap. Hover a day to see how many cups you had."
        />
      </ChartCard>
    </ChartPage>
  );
}
