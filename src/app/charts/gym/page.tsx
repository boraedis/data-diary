import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getGymWeightComboData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function GymWeightChartPage() {
  const data = await getGymWeightComboData();
  const empty = data.weight.length === 0 && data.workoutsByMonth.length === 0;

  return (
    <ChartPage title="Weight & training volume">
      <ChartCard
        title="Weight & training volume"
        description="Weight (line, left axis) against workouts logged per month (bars, right axis)."
        empty={empty}
      >
        <GymWeightComboChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
