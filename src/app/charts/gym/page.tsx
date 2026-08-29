import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getGymWeightComboData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function GymWeightChartPage() {
  const data = await getGymWeightComboData();
  const empty = data.weight.length === 0 && data.workoutsByMonth.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-4xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Weight &amp; training volume
        </h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Weight & training volume"
        description="Weight (line, left axis) against workouts logged per month (bars, right axis)."
        empty={empty}
      >
        <GymWeightComboChart data={data} />
      </ChartCard>
    </main>
  );
}
