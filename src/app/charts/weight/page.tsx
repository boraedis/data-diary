import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getWeightScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function WeightChartPage() {
  const data = await getWeightScrollerData();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-4xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Weight over time
        </h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Weight over time"
        description="Drag on the strip below the chart to zoom into a range; click to reset."
        empty={data.length === 0}
      >
        <WeightScrollerChart data={data} />
      </ChartCard>
    </main>
  );
}
