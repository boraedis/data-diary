import { PlaceHierarchyExplorer } from "@/components/charts/place-hierarchy-explorer";
import { getPlaceHierarchyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// Page body (title, filters row, chart card) lives entirely in the client
// explorer rather than being split with this server component — its
// grouping/ring state is shared between ChartPage's filters slot and the
// chart itself, so both have to come from one tree. Same shape as
// /charts/exercise-mix; see that page's own comment.
export default async function PlaceHierarchyChartPage() {
  const rows = await getPlaceHierarchyData();
  return <PlaceHierarchyExplorer rows={rows} />;
}
