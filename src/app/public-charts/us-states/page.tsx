import type { Metadata } from "next";
import { UsStateVisitsChart } from "@/components/charts/us-state-visits-chart";
import {
  getPublicUnloggedTravelCodes,
  getPublicUnloggedTravelDetails,
  getPublicUsCountyVisitData,
  getPublicUsStateVisitData,
} from "@/lib/public-charts";
import { getPublicDiaryStartDate } from "@/lib/public-profile";

export const metadata: Metadata = {
  title: "US Heatmap — Data Diary",
  description: "A heatmap of the US describing where I have visited and spent time in.",
};

// Public counterpart to src/app/(app)/charts/us-states/page.tsx (#453,
// plus a follow-up on that issue enabling the drill-down and
// unlogged-travel overlay here too) — full state -> county/metro
// drill-down and the unlogged-travel tint. showManageLink={false} still
// hides the unlogged-travel *manage* link: that's an edit action behind
// the session gate, not view data.
export const dynamic = "force-dynamic";

export default async function PublicUsStateVisitsChartPage() {
  const [data, counties, travelled, travelledDetails, diaryStartDate] = await Promise.all([
    getPublicUsStateVisitData(),
    getPublicUsCountyVisitData(),
    getPublicUnloggedTravelCodes("us_county"),
    getPublicUnloggedTravelDetails("us_county"),
    getPublicDiaryStartDate(),
  ]);

  return (
    <UsStateVisitsChart
      data={data}
      counties={counties}
      travelledCounties={[...travelled]}
      travelledCountyDetails={[...travelledDetails]}
      diaryStartDate={diaryStartDate}
      showManageLink={false}
      backHref="/public-charts"
      backLabel="Charts"
    />
  );
}
