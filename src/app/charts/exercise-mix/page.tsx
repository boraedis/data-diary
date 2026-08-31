import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ExerciseAreaChart } from "@/components/charts/exercise-area-chart";
import { getExerciseAreaData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function ExerciseMixChartPage() {
  const data = await getExerciseAreaData();

  return (
    <ChartPage title="Exercise mix">
      <ChartCard
        title="Exercise mix"
        description="Monthly workout count by category — distance, sport, or strength. Toggle Count/% share, click a legend entry to hide a category."
        empty={data.points.length === 0}
      >
        <ExerciseAreaChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
