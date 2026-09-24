import { PlaceLeaderboardChart } from "@/components/charts/place-leaderboard";
import { getPlaceLeaderboardData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/people-table does: the "Show" filter and the table share
// state, and only plain data can cross the server/client boundary.
export default async function PlacesChartPage() {
  const entries = await getPlaceLeaderboardData();
  return <PlaceLeaderboardChart entries={entries} />;
}
