import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import {
  EXERCISE_MODES,
  exerciseColumns,
  FOCUS_LEVELS,
  getExerciseLeaderboardData,
  type ExerciseMode,
  type FocusLevel,
} from "@/lib/leaderboards/exercise";
import { pickOption, type LeaderboardPicker, type SearchParams } from "@/lib/leaderboards/options";
import { TRAINING_METHODOLOGY } from "@/lib/viz/methodology";
import { TRAINING_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<ExerciseMode, string> = {
  exercise: "The exercises I've spent the most time on.",
  focus: "Training time by focus or subfocus — an exercise with several counts toward each.",
  category: "Training time by category: distance, sport and strength.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = pickOption(params.by, EXERCISE_MODES);
  const pickers: LeaderboardPicker[] = [{ param: "by", label: "Rank", value: mode, options: EXERCISE_MODES }];
  let level: FocusLevel = "focus";
  if (mode === "focus") {
    level = pickOption(params.level, FOCUS_LEVELS);
    pickers.push({ param: "level", label: "Level", value: level, options: FOCUS_LEVELS });
  }
  const rows = await getExerciseLeaderboardData(mode, level);
  return (
    <LeaderboardExplorer
      title="Exercise Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={TRAINING_METHODOLOGY}
      trackingSpan={TRAINING_TRACKING_SPAN}
      pickers={pickers}
      rows={rows}
      columns={exerciseColumns(mode, level)}
      ariaLabel="Exercise ranked by training time, with how each has moved over the last week, month and year."
    />
  );
}
