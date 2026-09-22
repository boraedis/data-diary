import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { getFirstExerciseDate, getProfileRegionGroups, getWeightScrollerData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function WeightChartPage() {
  // Weight data starts on/after the first logged workout (#411) — years of
  // pre-exercise weight history has no training to relate it to.
  const firstExerciseDate = await getFirstExerciseDate();
  const [data, regionGroups] = await Promise.all([
    getWeightScrollerData(firstExerciseDate ?? undefined),
    getProfileRegionGroups(),
  ]);

  return <WeightScrollerChart data={data} regionGroups={regionGroups} />;
}
