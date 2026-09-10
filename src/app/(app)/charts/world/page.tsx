import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WorldVisitsChart } from "@/components/charts/world-visits-chart";
import { getCountryVisitData, getUsStateVisitData } from "@/lib/charts";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const dynamic = "force-dynamic";

export default async function WorldVisitsChartPage() {
  // State counts come with the page so clicking the US only has to fetch
  // geometry (#107) — it's the same few-thousand-row scan the country
  // query already does, and one round trip beats two on a click.
  const [data, usStates] = await Promise.all([getCountryVisitData(), getUsStateVisitData()]);

  return (
    <ChartPage
      title="Days per country"
      description="Distinct days logged in each country. Click the US to drill into its states."
      info={{ interactionGuide: GEO_INTERACTION_GUIDE }}
    >
      <ChartCard fillHeight empty={data.length === 0}>
        <WorldVisitsChart data={data} usStates={usStates} />
      </ChartCard>
    </ChartPage>
  );
}
