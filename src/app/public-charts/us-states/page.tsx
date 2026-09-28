import type { Metadata } from "next";
import { UsStateVisitsChart } from "@/components/charts/us-state-visits-chart";
import { getPublicUsStateVisitData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "US Heatmap — Data Diary",
  description: "A heatmap of the US describing where I have visited and spent time in.",
};

// Public counterpart to src/app/(app)/charts/us-states/page.tsx (#453) —
// state-level only, per the owner's decision on that issue: no county
// data fetched, so the county/metro view modes and the state->county
// drill-in render as empty rather than exposing that granularity
// publicly. showManageLink=false hides the unlogged-travel manage link,
// which sits behind the session gate.
export const dynamic = "force-dynamic";

const EMPTY_COUNTIES = { counties: [], unresolvedDays: 0 };

export default async function PublicUsStateVisitsChartPage() {
  const data = await getPublicUsStateVisitData();

  return (
    <UsStateVisitsChart
      data={data}
      counties={EMPTY_COUNTIES}
      showManageLink={false}
      backHref="/public-charts"
      backLabel="Charts"
    />
  );
}
