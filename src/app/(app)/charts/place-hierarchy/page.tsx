import { PlaceHierarchyExplorer } from "@/components/charts/place-hierarchy-explorer";
import { getAreaColors, getPlaceHierarchyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// Page body (title, filters row, chart card) lives entirely in the client
// explorer rather than being split with this server component — its
// grouping/ring state is shared between ChartPage's filters slot and the
// chart itself, so both have to come from one tree. Same shape as
// /charts/exercise-mix; see that page's own comment.
export default async function PlaceHierarchyChartPage() {
  // Area colours for Metro mode (#215), shared with the Centre of Gravity
  // map, fetched alongside rather than on switching mode: it's a handful
  // of entries, and switching should be instant.
  const [rows, areaColors] = await Promise.all([getPlaceHierarchyData(), getAreaColors()]);
  return <PlaceHierarchyExplorer rows={rows} areaColors={areaColors} />;
}
