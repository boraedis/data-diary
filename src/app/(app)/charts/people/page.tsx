import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { PeopleNetworkChart } from "@/components/charts/people-network-chart";
import { getPeopleNetworkData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// Raised from the original 40 (#23 follow-up) now that InteractiveNetwork
// supports scroll/pinch zoom — a denser graph is still navigable instead of
// just unreadable at a fixed size.
const MAX_NODES = 100;

export default async function PeopleNetworkChartPage() {
  const data = await getPeopleNetworkData(MAX_NODES);

  return (
    <ChartPage title="People network">
      <ChartCard
        title="People network"
        description="The 100 most-logged people; connected when logged together on more than one day. Scroll to zoom, drag the background to pan, drag a person to reposition them, click a person to highlight their connections."
        empty={data.nodes.length === 0}
      >
        <PeopleNetworkChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
