import type { Metadata } from "next";
import { DistanceTrendChart } from "@/components/charts/distance-charts";
import { getPublicDistanceDailyData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Distance Walked Trend — Data Diary",
  description: "Trend in distance walked over time, aggregated by period.",
};

// Public counterpart to src/app/(app)/charts/distance-trend/page.tsx (#453).
export const dynamic = "force-dynamic";

export default async function PublicDistanceTrendChartPage() {
  const data = await getPublicDistanceDailyData();
  return <DistanceTrendChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
