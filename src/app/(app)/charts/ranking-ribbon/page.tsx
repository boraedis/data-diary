import { RankingRibbonChart } from "@/components/charts/ranking-ribbon-chart";
import { buildRibbon, getRankingEvents } from "@/lib/ranking-ribbon";

export const dynamic = "force-dynamic";

// Both lists' histories are small (a handful of events per save), so each is
// replayed here and the client only receives the finished ribbons.
export default async function Page() {
  const [movie, book] = await Promise.all([getRankingEvents("movie"), getRankingEvents("book")]);
  return <RankingRibbonChart ribbons={{ movie: buildRibbon(movie), book: buildRibbon(book) }} />;
}
