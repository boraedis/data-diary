import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WorldVisitsChart } from "@/components/charts/world-visits-chart";
import {
  getPublicAdminRegionVisitData,
  getPublicCountryVisitData,
  getPublicUnloggedTravelCodes,
  getPublicUnloggedTravelDetails,
  getPublicUsStateVisitData,
} from "@/lib/public-charts";
import { getPublicDiaryStartDate } from "@/lib/public-profile";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const metadata: Metadata = {
  title: "World Heatmap — Data Diary",
  description: "A heatmap of the world describing which countries I have visited and spent time in.",
};

// Public counterpart to src/app/(app)/charts/world/page.tsx (#453, plus a
// follow-up on that issue enabling the drill-down and unlogged-travel
// overlay here too) — full country -> state/admin-region drill-down and
// the unlogged-travel tint, same data the private page shows: none of it
// is address/lat-lng/people/free-text (see public-charts.ts's own
// comments on why each of these is safe). The one thing still withheld is
// the *manage* link (ManageUnloggedTravelLink) — that's an edit action
// behind the session gate, not view data, so it stays private-only
// (WorldVisitsChart has no such link itself; it lives in the private
// page's own filters row, which this page doesn't add).
export const dynamic = "force-dynamic";

export default async function PublicWorldVisitsChartPage() {
  const [data, usStates, adminRegions, travelledCountries, travelledCounties, travelledCountryDetails, diaryStartDate] =
    await Promise.all([
      getPublicCountryVisitData(),
      getPublicUsStateVisitData(),
      getPublicAdminRegionVisitData(),
      getPublicUnloggedTravelCodes("country"),
      getPublicUnloggedTravelCodes("us_county"),
      getPublicUnloggedTravelDetails("country"),
      getPublicDiaryStartDate(),
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
      backHref="/public-charts"
      backLabel="Charts"
    >
      <ChartCard empty={data.length === 0}>
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
