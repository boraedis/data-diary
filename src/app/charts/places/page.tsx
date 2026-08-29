import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { PlaceLeaderboard } from "@/components/charts/place-leaderboard";
import { getPlaceLeaderboardData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function PlacesChartPage() {
  const entries = await getPlaceLeaderboardData();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Most-visited places
        </h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Most-visited places"
        description="Top 15, weighted 2x for a day's first place slot and 1x for the second."
        empty={entries.length === 0}
      >
        <PlaceLeaderboard entries={entries} />
      </ChartCard>
    </main>
  );
}
