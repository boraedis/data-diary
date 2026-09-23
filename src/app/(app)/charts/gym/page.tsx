import { GymWeightComboChart } from "@/components/charts/gym-weight-combo-chart";
import { getFirstExerciseDate, getGymWeightComboData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the range picker and the chart share state,
// and only plain data can cross the server/client boundary.
export default async function GymWeightChartPage() {
  // The chart gets the *full* weight/training history (#411 originally
  // restricted this in SQL, which made older weight data unreachable —
  // see getGymWeightComboData's own doc comment) and defaults its own
  // range picker to the region where both fields actually have data,
  // rather than defaulting to the full domain the way most range pickers
  // in this app do.
  const [data, firstExerciseDate] = await Promise.all([getGymWeightComboData(), getFirstExerciseDate()]);

  return <GymWeightComboChart data={data} defaultRangeStart={firstExerciseDate} />;
}
