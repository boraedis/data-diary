import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WorldVisitsChart } from "@/components/charts/world-visits-chart";
import { getPublicCountryVisitData } from "@/lib/public-charts";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const metadata: Metadata = {
  title: "World Heatmap — Data Diary",
  description: "A heatmap of the world describing which countries I have visited and spent time in.",
};

// Public counterpart to src/app/(app)/charts/world/page.tsx (#453) —
// country-level only, per the owner's decision on that issue. Unlike the
// private page, no usStates/adminRegions (the state/subdivision drill-down
// stays private-only) and no unlogged-travel props (that data, and its
// manage link, are private-only), so the map renders as a flat,
// non-drillable country choropleth.
export const dynamic = "force-dynamic";

export default async function PublicWorldVisitsChartPage() {
  const data = await getPublicCountryVisitData();

  return (
    <ChartPage
      title="World Heatmap"
      description="A heatmap of the world describing which countries I have visited and spent time in."
      info={{
        interactionGuide: GEO_INTERACTION_GUIDE,
        methodology: PLACES_METHODOLOGY,
        trackingSpan: PLACES_TRACKING_SPAN,
      }}
      backHref="/public-charts"
      backLabel="Charts"
    >
      <ChartCard empty={data.length === 0}>
        <WorldVisitsChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
