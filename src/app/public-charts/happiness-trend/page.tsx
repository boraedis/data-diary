import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { HappinessAveragerChart } from "@/components/charts/happiness-averager-chart";
import { getPublicHappinessTrendData } from "@/lib/public-charts";
import { LINE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const metadata: Metadata = {
  title: "Happiness trend — Data Diary",
  description: "Monthly average happiness over time.",
};

// Public counterpart to src/app/charts/happiness-trend/page.tsx (#84/#12).
export const dynamic = "force-dynamic";

export default async function PublicHappinessTrendChartPage() {
  const data = await getPublicHappinessTrendData();

  return (
    <ChartPage
      title="Happiness trend"
      description="Monthly average happiness."
      info={{ interactionGuide: LINE_INTERACTION_GUIDE }}
      backHref="/public-charts"
      backLabel="Charts"
    >
      <ChartCard empty={data.length === 0}>
        <HappinessAveragerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
