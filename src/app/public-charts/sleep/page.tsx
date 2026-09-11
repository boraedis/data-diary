import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getPublicSleepData } from "@/lib/public-charts";
import { CALENDAR_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { SLEEP_METHODOLOGY } from "@/lib/viz/methodology";
import { SLEEP_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const metadata: Metadata = {
  title: "Sleep Calendar — Data Diary",
  description: "A year-by-year heatmap of nightly sleep duration.",
};

// Public counterpart to src/app/charts/sleep/page.tsx (#84/#12).
export const dynamic = "force-dynamic";

export default async function PublicSleepChartPage() {
  const data = await getPublicSleepData();

  return (
    <ChartPage
      title="Sleep Calendar"
      description="Nightly sleep duration, darker = less sleep, brighter = more."
      info={{
        interactionGuide: CALENDAR_INTERACTION_GUIDE,
        methodology: SLEEP_METHODOLOGY,
        trackingSpan: SLEEP_TRACKING_SPAN,
      }}
      backHref="/public-charts"
      backLabel="Charts"
    >
      <ChartCard empty={data.length === 0}>
        <SleepCalendarChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
