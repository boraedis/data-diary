import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getSleepCalendarData } from "@/lib/charts";
import { CALENDAR_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const dynamic = "force-dynamic";

export default async function SleepChartPage() {
  const data = await getSleepCalendarData();

  return (
    <ChartPage
      title="Sleep calendar"
      description="Nightly sleep duration, darker = less sleep, brighter = more."
      info={{ interactionGuide: CALENDAR_INTERACTION_GUIDE }}
    >
      <ChartCard empty={data.length === 0}>
        <SleepCalendarChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
