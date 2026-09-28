import type { Metadata } from "next";
import { CoffeeTrendChart } from "@/components/charts/coffee-charts";
import { getPublicCoffeeDailyData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Coffee Trend — Data Diary",
  description: "Trend in coffee over time, aggregated by period.",
};

// Public counterpart to src/app/(app)/charts/coffee-trend/page.tsx (#453).
export const dynamic = "force-dynamic";

export default async function PublicCoffeeTrendChartPage() {
  const data = await getPublicCoffeeDailyData();
  return <CoffeeTrendChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
