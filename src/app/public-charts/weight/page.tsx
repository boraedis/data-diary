import type { Metadata } from "next";
import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getPublicWeightData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Weight over time — Data Diary",
  description: "A zoomable line chart of weight, body fat %, and muscle mass logged over time.",
};

// Public counterpart to src/app/charts/weight/page.tsx (#84/#12) — same
// component, fed by public-charts.ts instead of the authenticated
// charts.ts. No `regionGroups` passed: the Age/Occupation/Residence/
// Relationship region overlays are backed by src/lib/profile.ts's private
// timelines and stay private-only (explicit call — see #117's follow-up
// thread), so WeightScrollerChart's region-type picker simply doesn't
// render here at all.
export const dynamic = "force-dynamic";

export default async function PublicWeightChartPage() {
  const data = await getPublicWeightData();

  return <WeightScrollerChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
