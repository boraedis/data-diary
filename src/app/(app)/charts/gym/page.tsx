import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getGymWeightComboData } from "@/lib/charts";
import { COMBO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

export const dynamic = "force-dynamic";

export default async function GymWeightChartPage() {
  const data = await getGymWeightComboData();
  const empty = data.weight.length === 0 && data.workoutsByMonth.length === 0;

  return (
    <ChartPage
      title="Weight and Training Volume"
      description="Weight (line, left axis) against workouts logged per month (bars, right axis)."
      info={{ interactionGuide: COMBO_INTERACTION_GUIDE }}
    >
      <ChartCard empty={empty}>
        <GymWeightComboChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
