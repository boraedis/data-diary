import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getGymWeightComboData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function GymWeightChartPage() {
  const data = await getGymWeightComboData();
  const empty = data.weight.length === 0 && data.workoutsByMonth.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Weight &amp; training volume</h1>
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
