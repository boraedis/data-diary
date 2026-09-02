import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getPublicSleepData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Sleep calendar — Data Diary",
  description: "A year-by-year heatmap of nightly sleep duration.",
};

// Public counterpart to src/app/charts/sleep/page.tsx (#84/#12).
export const dynamic = "force-dynamic";

export default async function PublicSleepChartPage() {
  const data = await getPublicSleepData();

  return (
    <ChartPage title="Sleep calendar" backHref="/public-charts" backLabel="Charts">
      <ChartCard
        title="Sleep calendar"
        description="Nightly sleep duration, darker = less sleep, brighter = more."
        empty={data.length === 0}
      >
        <SleepCalendarChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
