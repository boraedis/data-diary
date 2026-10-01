import { TvBacklogChart } from "@/components/charts/tv-backlog-chart";
import { buildBacklogSeries, getBacklogEvents } from "@/lib/tv-backlog";

export const dynamic = "force-dynamic";

// The daily series is a few thousand plain rows at most, built here so the
// client only receives per-show levels — see src/lib/tv-backlog.ts.
export default async function Page() {
  const series = buildBacklogSeries(await getBacklogEvents());
  return <TvBacklogChart series={series} />;
}
