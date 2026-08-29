import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { SubsSmallMultiples } from "@/components/charts/subs-small-multiples";
import { getSubsScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function SubsChartPage() {
  const data = await getSubsScrollerData();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-5xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Subs over time
        </h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Subs over time"
        description="One mini chart per sub, 0-10 scale."
        empty={data.length === 0}
      >
        <SubsSmallMultiples data={data} />
      </ChartCard>
    </main>
  );
}
