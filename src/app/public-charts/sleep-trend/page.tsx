import type { Metadata } from "next";
import { SleepTrendChart } from "@/components/charts/sleep-charts";
import { getPublicSleepTrendData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Sleep Trend — Data Diary",
  description: "Trend in sleep duration over time, aggregated by period.",
};

// Public counterpart to src/app/(app)/charts/sleep-trend/page.tsx (#453).
export const dynamic = "force-dynamic";

export default async function PublicSleepTrendChartPage() {
  const data = await getPublicSleepTrendData();
  return <SleepTrendChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
