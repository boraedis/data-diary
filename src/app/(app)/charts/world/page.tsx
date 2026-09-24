import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ManageUnloggedTravelLink } from "@/components/charts/manage-unlogged-travel-link";
import { WorldVisitsChart } from "@/components/charts/world-visits-chart";
import { getAdminRegionVisitData, getCountryVisitData, getUsStateVisitData } from "@/lib/charts";
import { getUnloggedTravelCodes, getUnloggedTravelDetails } from "@/lib/unlogged-travel";
import { getProfileSettings } from "@/lib/profile";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

export default async function WorldVisitsChartPage() {
  // State counts come with the page so clicking the US only has to fetch
  // geometry (#107) — it's the same few-thousand-row scan the country
  // query already does, and one round trip beats two on a click.
  //
  // Both unlogged-travel kinds (#366) ride along in the same round trip:
  // countries for the base map, and counties because the US expansion
  // tints its states from the county roll-up, the same way
  // /charts/us-states' drill view does. Codes only — the map's question is
  // pure membership, so the dates and notes stay behind on the manage
  // surface.
  // travelledCountryDetails (#370) rides along too — the country tier's
  // tooltip secondary row needs each travelled entry's own first_visited,
  // not just membership, so this is a details map rather than reusing
  // travelledCountries' codes-only Set above.
  //
  // Subdivisions for every other country (#304) ride along the same way
  // states do, so a click only waits on that country's geometry file.
  const [data, usStates, adminRegions, travelledCountries, travelledCounties, travelledCountryDetails, { diaryStartDate }] =
    await Promise.all([
      getCountryVisitData(),
      getUsStateVisitData(),
      getAdminRegionVisitData(),
      getUnloggedTravelCodes("country"),
      getUnloggedTravelCodes("us_county"),
      getUnloggedTravelDetails("country"),
      getProfileSettings(),
    ]);

  return (
    <ChartPage
      title="World Heatmap"
      description="A heatmap of the world describing which countries I have visited and spent time in. Click a country to break it into its states, provinces or regions."
      info={{
        interactionGuide: GEO_INTERACTION_GUIDE,
        methodology: PLACES_METHODOLOGY,
        trackingSpan: PLACES_TRACKING_SPAN,
      }}
      // This map has no view/period controls of its own, so the row exists
      // only to carry the manage link — see ManageUnloggedTravelLink on why
      // it belongs on the chart page at all.
      filters={<ManageUnloggedTravelLink />}
    >
      <ChartCard empty={data.length === 0}>
        {/* Sets spread to arrays at the boundary — a Set doesn't cross
            into a client component as a prop. */}
        <WorldVisitsChart
          data={data}
          usStates={usStates}
          adminRegions={adminRegions}
          travelledCountries={[...travelledCountries]}
          travelledCounties={[...travelledCounties]}
          travelledCountryDetails={[...travelledCountryDetails]}
          diaryStartDate={diaryStartDate}
        />
      </ChartCard>
    </ChartPage>
  );
}
