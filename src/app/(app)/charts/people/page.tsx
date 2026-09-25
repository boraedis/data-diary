import { PeopleNetworkChart } from "@/components/charts/people-network-chart";
import { getPeopleNetworkData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card),
// the same way /charts/life-timeline does: the filters and the graph share
// state, and the graph is built client-side from the raw per-day lists so
// those filters respond without a server round-trip.
export default async function PeopleNetworkChartPage() {
  const data = await getPeopleNetworkData();
  return <PeopleNetworkChart data={data} />;
}
