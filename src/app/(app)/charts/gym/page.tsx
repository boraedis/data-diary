import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getFirstExerciseDate, getGymWeightComboData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the range picker and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function GymWeightChartPage() {
  // Scoped to dates on/after the first tracked exercise (#411) — this
  // chart's own point is relating weight to training, so years of weight
  // history predating any training isn't useful context for it. See
  // getGymWeightComboData's own `since` doc comment.
  const firstExerciseDate = await getFirstExerciseDate();
  const data = await getGymWeightComboData(firstExerciseDate ?? undefined);

  return <GymWeightComboChart data={data} />;
}
