import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getSleepCalendarData } from "@/lib/charts";
import { CALENDAR_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { SLEEP_METHODOLOGY } from "@/lib/viz/methodology";
import { SLEEP_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

export default async function SleepChartPage() {
  const data = await getSleepCalendarData();

  return (
    <ChartPage
      title="Sleep Calendar"
      description="Nightly sleep duration, darker = less sleep, brighter = more."
      info={{
        interactionGuide: CALENDAR_INTERACTION_GUIDE,
        methodology: SLEEP_METHODOLOGY,
        trackingSpan: SLEEP_TRACKING_SPAN,
      }}
    >
      <ChartCard empty={data.length === 0}>
        <SleepCalendarChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
