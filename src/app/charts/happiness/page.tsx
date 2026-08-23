import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { HistogramChart } from "@/components/charts/histogram-chart";
import { getHappinessHistogramData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function HappinessChartPage() {
  const values = await getHappinessHistogramData();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Happiness distribution</h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Happiness distribution"
        description={`${values.length} day${values.length === 1 ? "" : "s"} logged, bucketed in 10-point ranges.`}
        empty={values.length === 0}
      >
        <HistogramChart values={values} />
      </ChartCard>
    </main>
  );
}
