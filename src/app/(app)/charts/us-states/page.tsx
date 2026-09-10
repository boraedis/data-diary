import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { UsStateVisitsChart } from "@/components/charts/us-state-visits-chart";
import { getUsCountyVisitData, getUsStateVisitData } from "@/lib/charts";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const dynamic = "force-dynamic";

export default async function UsStateVisitsChartPage() {
  // County data is fetched with the page rather than on first drill-in
  // (#107): it's a small payload (one row per county that has any days —
  // ~100), and the expensive half is the point-in-polygon join, which has
  // to happen server-side either way. Fetching it up front keeps the
  // drill-in itself down to loading geometry, with no second round trip.
  const [data, counties] = await Promise.all([getUsStateVisitData(), getUsCountyVisitData()]);

  return (
    <ChartPage
      title="Days per state"
      description="Distinct days logged in each US state. Click a state to drill into its counties."
      info={{ interactionGuide: GEO_INTERACTION_GUIDE }}
    >
      <ChartCard
        // Only the whole-country case is empty here — a state you've never
        // been to is a real, meaningful zero, and InteractiveGeo already
        // renders it as a muted "no data" fill with its own tooltip row
        // rather than a gap. Blanking the card because 18 states have no
        // days would throw away the most interesting thing the map says.
        empty={data.length === 0}
      >
        <UsStateVisitsChart data={data} counties={counties} />
      </ChartCard>
    </ChartPage>
  );
}
