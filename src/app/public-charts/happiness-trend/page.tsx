import type { Metadata } from "next";
import { HappinessTrendChart } from "@/components/charts/happiness-trend-chart";
import { getPublicHappinessTrendData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Happiness Trend — Data Diary",
  description: "Trend in happiness over time, aggregated by period.",
};

// Public counterpart to src/app/charts/happiness-trend/page.tsx (#84/#12).
export const dynamic = "force-dynamic";

export default async function PublicHappinessTrendChartPage() {
  const data = await getPublicHappinessTrendData();
  return <HappinessTrendChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
