import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { DailyValueScroller } from "@/components/charts/daily-value-scroller";
import { getDistanceScrollerData } from "@/lib/charts";
import { categoricalColor } from "@/lib/viz/color";

export const dynamic = "force-dynamic";

export default async function DistanceDailyChartPage() {
  const data = await getDistanceScrollerData();

  return (
    <ChartPage title="Daily distance walked">
      <ChartCard
        title="Daily distance walked"
        description="Every logged day. Scroll or drag to zoom, and use the strip below to move through the range."
        empty={data.length === 0}
      >
        <DailyValueScroller
          data={data}
          seriesId="distance"
          label="Distance walked"
          color={categoricalColor(3)}
          valueFormat={(v) => `${v.toFixed(1)} km`}
          ariaLabel="Daily distance walked. Scroll or pinch to zoom, drag to pan, hover a day for its exact distance."
        />
      </ChartCard>
    </ChartPage>
  );
}
