import { ExerciseMixExplorer } from "@/components/charts/exercise-mix-explorer";
import { getExerciseWorkoutRows } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The interactive page body (title, filters row, and chart card) is one
// client component (ExerciseMixExplorer) rather than split between this
// server page and a chart component the way earlier chart pages are —
// its period/range/group-by state has to be shared between the filters
// row (ChartPage's dedicated slot, rendered above the card) and the chart
// itself, and both need to come from the same component tree to share
// that state. See that file's own header comment.
export default async function ExerciseMixChartPage() {
  const rows = await getExerciseWorkoutRows();
  return <ExerciseMixExplorer rows={rows} />;
}
