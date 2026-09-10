import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { LifeTimelineChart } from "@/components/charts/life-timeline-chart";
import { getLifeTimelineData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function LifeTimelineChartPage() {
  const entries = await getLifeTimelineData();

  return (
    <ChartPage title="Life timeline">
      <ChartCard
        title="Life timeline"
        description="Occupation, residence and relationship history. Overlapping entries stack within their lane; an entry with no end date is still running. Scroll to zoom, drag to pan, hover for dates."
        empty={entries.length === 0}
      >
        <LifeTimelineChart entries={entries} />
      </ChartCard>
    </ChartPage>
  );
}
