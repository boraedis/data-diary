import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { PlaceLeaderboard } from "@/components/charts/place-leaderboard";
import { getPlaceLeaderboardData } from "@/lib/charts";
import { RANKED_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const dynamic = "force-dynamic";

export default async function PlacesChartPage() {
  const entries = await getPlaceLeaderboardData();

  return (
    <ChartPage
      title="Most-visited places"
      description="Top 30, weighted 2x for a day's first place slot and 1x for the second."
      info={{ interactionGuide: RANKED_INTERACTION_GUIDE }}
    >
      <ChartCard empty={entries.length === 0}>
        <PlaceLeaderboard entries={entries} />
      </ChartCard>
    </ChartPage>
  );
}
