import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { PlaceLeaderboard } from "@/components/charts/place-leaderboard";
import { getPlaceLeaderboardData } from "@/lib/charts";
import { RANKED_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";

export const dynamic = "force-dynamic";

export default async function PlacesChartPage() {
  const entries = await getPlaceLeaderboardData();

  return (
    <ChartPage
      title="Place Leaderboard"
      description="A leaderboard of my most mentioned locations."
      info={{ interactionGuide: RANKED_INTERACTION_GUIDE, methodology: PLACES_METHODOLOGY }}
    >
      <ChartCard empty={entries.length === 0}>
        <PlaceLeaderboard entries={entries} />
      </ChartCard>
    </ChartPage>
  );
}
