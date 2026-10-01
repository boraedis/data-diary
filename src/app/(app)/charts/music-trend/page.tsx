import { MusicTrendExplorer } from "@/components/charts/music-trend-explorer";
import { getMusicTrendByArtist, getMusicTrendByGroup } from "@/lib/music-trend";

export const dynamic = "force-dynamic";

// Both groupings are fetched up front: each is already folded to a few
// hundred rows at most (see music-trend.ts), and the toggle between them
// lives in the client explorer alongside the other filters.
export default async function MusicTrendPage() {
  const [artist, group] = await Promise.all([getMusicTrendByArtist(), getMusicTrendByGroup()]);
  return <MusicTrendExplorer artist={artist} group={group} />;
}
