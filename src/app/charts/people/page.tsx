import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { PeopleNetworkChart } from "@/components/charts/people-network-chart";
import { getPeopleNetworkData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function PeopleNetworkChartPage() {
  const data = await getPeopleNetworkData();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">People network</h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="People network"
        description="The 40 most-logged people; connected when logged together on the same day. Drag to reposition."
        empty={data.nodes.length === 0}
      >
        <PeopleNetworkChart data={data} />
      </ChartCard>
    </main>
  );
}
