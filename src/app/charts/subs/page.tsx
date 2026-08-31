import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { SubsSmallMultiples } from "@/components/charts/subs-small-multiples";
import { getSubsScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function SubsChartPage() {
  const data = await getSubsScrollerData();

  return (
    <ChartPage title="Subs over time">
      <ChartCard title="Subs over time" description="One mini chart per sub, 0-10 scale." empty={data.length === 0}>
        <SubsSmallMultiples data={data} />
      </ChartCard>
    </ChartPage>
  );
}
