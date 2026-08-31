import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { PeopleNetworkChart } from "@/components/charts/people-network-chart";
import { getPeopleNetworkData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function PeopleNetworkChartPage() {
  const data = await getPeopleNetworkData();

  return (
    <ChartPage title="People network">
      <ChartCard
        title="People network"
        description="The 40 most-logged people; connected when logged together on the same day. Drag to reposition."
        empty={data.nodes.length === 0}
      >
        <PeopleNetworkChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
