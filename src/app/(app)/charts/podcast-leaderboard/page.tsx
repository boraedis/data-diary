import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { getPodcastLeaderboardData, PODCAST_MODES, podcastColumns, type PodcastMode } from "@/lib/leaderboards/listens";
import { pickOption, type SearchParams } from "@/lib/leaderboards/options";
import { PODCAST_METHODOLOGY } from "@/lib/viz/methodology";
import { PODCAST_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<PodcastMode, string> = {
  show: "The podcasts I've listened to most, by total listening time.",
  category: "Podcast listening time by category.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const mode = pickOption((await searchParams).by, PODCAST_MODES);
  const rows = await getPodcastLeaderboardData(mode);
  return (
    <LeaderboardExplorer
      title="Podcast Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={PODCAST_METHODOLOGY}
      trackingSpan={PODCAST_TRACKING_SPAN}
      pickers={[{ param: "by", label: "Rank", value: mode, options: PODCAST_MODES }]}
      rows={rows}
      columns={podcastColumns(mode)}
      ariaLabel="Podcasts ranked by listening time, with how each has moved over the last week, month and year."
    />
  );
}
