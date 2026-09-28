import type { Metadata } from "next";
import { ExerciseMixExplorer } from "@/components/charts/exercise-mix-explorer";
import { getPublicExerciseWorkoutRows } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Exercise Mix — Data Diary",
  description: "A breakdown of how I exercised, aggregated by period.",
};

// Public counterpart to src/app/(app)/charts/exercise-mix/page.tsx (#453).
export const dynamic = "force-dynamic";

export default async function PublicExerciseMixChartPage() {
  const rows = await getPublicExerciseWorkoutRows();
  return <ExerciseMixExplorer rows={rows} backHref="/public-charts" backLabel="Charts" />;
}
