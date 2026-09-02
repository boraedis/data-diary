import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HappinessAveragerChart } from "@/components/charts/happiness-averager-chart";
import { getPublicHappinessTrendData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Happiness trend — Data Diary",
  description: "Monthly average happiness over time.",
};

// Public counterpart to src/app/charts/happiness-trend/page.tsx (#84/#12).
export const dynamic = "force-dynamic";

export default async function PublicHappinessTrendChartPage() {
  const data = await getPublicHappinessTrendData();

  return (
    <ChartPage title="Happiness trend" backHref="/public-charts" backLabel="Charts">
      <ChartCard
        title="Happiness trend"
        description="Monthly average, marker size shows how many days fed each point; shaded band shows that month's day-to-day range."
        empty={data.length === 0}
      >
        <HappinessAveragerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
