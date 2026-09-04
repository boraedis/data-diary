import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getPublicWeightData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Weight over time — Data Diary",
  description: "A zoomable line chart of weight logged over time.",
};

// Public counterpart to src/app/charts/weight/page.tsx (#84/#12) — same
// component and shell, fed by public-charts.ts instead of the
// authenticated charts.ts. No filters prop passed, so ChartPage's default
// "Filters & tools" placeholder shows, exactly like the private page —
// this chart doesn't have real filter controls yet on either side.
export const dynamic = "force-dynamic";

export default async function PublicWeightChartPage() {
  const data = await getPublicWeightData();

  return (
    <ChartPage title="Weight over time" backHref="/public-charts" backLabel="Charts">
      <ChartCard
        title="Weight over time"
        description="Scroll or drag on the chart to zoom, or drag the strip below it; double-click to reset."
        empty={data.length === 0}
      >
        <WeightScrollerChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
