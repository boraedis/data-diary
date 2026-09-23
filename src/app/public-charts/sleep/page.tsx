import type { Metadata } from "next";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getPublicSleepData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Sleep Calendar — Data Diary",
  description: "A year-by-year heatmap of nightly sleep duration.",
};

// Public counterpart to src/app/charts/sleep/page.tsx (#84/#12).
export const dynamic = "force-dynamic";

export default async function PublicSleepChartPage() {
  const data = await getPublicSleepData();
  return <SleepCalendarChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
