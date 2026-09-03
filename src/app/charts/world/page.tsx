import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WorldVisitsChart } from "@/components/charts/world-visits-chart";
import { getCountryVisitData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function WorldVisitsChartPage() {
  const data = await getCountryVisitData();

  return (
    <ChartPage title="Days per country">
      <ChartCard
        title="Days per country"
        description="Distinct days logged in each country. Scroll to zoom, drag to pan, hover a country for the exact count."
        empty={data.length === 0}
      >
        <WorldVisitsChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
