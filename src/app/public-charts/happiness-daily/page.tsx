import type { Metadata } from "next";
import { HappinessScrollerChart } from "@/components/charts/happiness-scroller-chart";
import { getPublicHappinessScrollerData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Daily happiness — Data Diary",
  description: "A zoomable line chart of daily happiness scores logged over time.",
};

// Public counterpart to src/app/charts/happiness-daily/page.tsx (#117
// follow-up). No `regionGroups` passed — the Age/Occupation/Residence/
// Relationship overlays are backed by src/lib/profile.ts's private
// timelines and stay private-only, same call as the weight scroller's own
// public page.
export const dynamic = "force-dynamic";

export default async function PublicHappinessDailyChartPage() {
  const data = await getPublicHappinessScrollerData();

  return <HappinessScrollerChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
