import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { HappinessAveragerChart } from "@/components/charts/happiness-averager-chart";
import { getHappinessAveragerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function HappinessTrendChartPage() {
  const data = await getHappinessAveragerData();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-4xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Happiness trend
        </h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Happiness trend"
        description="Monthly average, marker size shows how many days fed each point."
        empty={data.length === 0}
      >
        <HappinessAveragerChart data={data} />
      </ChartCard>
    </main>
  );
}
