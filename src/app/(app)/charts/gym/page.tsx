import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getGymWeightComboData } from "@/lib/charts";
import { COMBO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { TRAINING_METHODOLOGY, WEIGHT_METHODOLOGY } from "@/lib/viz/methodology";
import { TRAINING_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

export default async function GymWeightChartPage() {
  const data = await getGymWeightComboData();
  const empty = data.weight.length === 0 && data.workoutsByMonth.length === 0;

  return (
    <ChartPage
      title="Weight and Training Volume"
      description="My weight against total weightlifting hours each month — a way to see whether time at the gym is helping build muscle."
      info={{
        interactionGuide: COMBO_INTERACTION_GUIDE,
        methodology: `${WEIGHT_METHODOLOGY} ${TRAINING_METHODOLOGY}`,
        // The later of the two fields' own start dates — training data is
        // what actually limits how far back this combo chart's bars go.
        trackingSpan: TRAINING_TRACKING_SPAN,
      }}
    >
      <ChartCard empty={empty}>
        <GymWeightComboChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
