import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { UsStateVisitsChart } from "@/components/charts/us-state-visits-chart";
import { getUsStateVisitData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function UsStateVisitsChartPage() {
  const data = await getUsStateVisitData();

  return (
    <ChartPage title="Days per state">
      <ChartCard
        title="Days per state"
        description="Distinct days logged in each US state. Scroll to zoom, drag to pan, hover a state for the exact count."
        // Only the whole-country case is empty here — a state you've never
        // been to is a real, meaningful zero, and InteractiveGeo already
        // renders it as a muted "no data" fill with its own tooltip row
        // rather than a gap. Blanking the card because 18 states have no
        // days would throw away the most interesting thing the map says.
        empty={data.length === 0}
      >
        <UsStateVisitsChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
