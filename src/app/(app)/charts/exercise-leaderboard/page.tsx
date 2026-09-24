import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { EXERCISE_MODES, exerciseColumns, getExerciseLeaderboardData, type ExerciseMode } from "@/lib/leaderboards/exercise";
import { pickOption, type SearchParams } from "@/lib/leaderboards/options";
import { TRAINING_METHODOLOGY } from "@/lib/viz/methodology";
import { TRAINING_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<ExerciseMode, string> = {
  exercise: "The exercises I've spent the most time on.",
  focus: "Training time by focus — an exercise with several focuses counts toward each.",
  category: "Training time by category: distance, sport and strength.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const mode = pickOption((await searchParams).by, EXERCISE_MODES);
  const rows = await getExerciseLeaderboardData(mode);
  return (
    <LeaderboardExplorer
      title="Exercise Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={TRAINING_METHODOLOGY}
      trackingSpan={TRAINING_TRACKING_SPAN}
      pickers={[{ param: "by", label: "Rank", value: mode, options: EXERCISE_MODES }]}
      rows={rows}
      columns={exerciseColumns(mode)}
      ariaLabel="Exercise ranked by training time, with how each has moved over the last week, month and year."
    />
  );
}
