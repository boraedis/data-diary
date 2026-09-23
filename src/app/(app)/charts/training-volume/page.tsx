import { TrainingVolumeChart } from "@/components/charts/training-volume-chart";
import { getExerciseWorkoutRows, getTrainingDailyData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/weight does: the filters row and the chart share state,
// and only plain data can cross the server/client boundary.
//
// `data` (zero-filled per day, already spanning exactly first-to-last
// workout — see getTrainingDailyData's own doc comment) supplies the
// calendar-day scaffold; `rows` (raw per-workout, already used by
// ExerciseMixExplorer) supplies the category/exercise breakdown. Both are
// naturally already scoped to "since exercise tracking began" by
// construction, with nothing further to filter.
export default async function Page() {
  const [data, rows] = await Promise.all([getTrainingDailyData(), getExerciseWorkoutRows()]);
  return <TrainingVolumeChart data={data} rows={rows} />;
}
