import type { Metadata } from "next";
import { PlaceHierarchyExplorer } from "@/components/charts/place-hierarchy-explorer";
import { getPublicPlaceHierarchyData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Place Sunburst — Data Diary",
  description: "A zoomable donut chart that lets you explore where I spent my time.",
};

// Public counterpart to src/app/(app)/charts/place-hierarchy/page.tsx
// (#453) — place names, categories and mention counts only, no lat/lng or
// address (see getPublicPlaceHierarchyData's own comment on why this
// reuses the private tree builder directly).
export const dynamic = "force-dynamic";

export default async function PublicPlaceHierarchyChartPage() {
  const rows = await getPublicPlaceHierarchyData();
  return <PlaceHierarchyExplorer rows={rows} backHref="/public-charts" backLabel="Charts" />;
}
