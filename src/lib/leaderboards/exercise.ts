import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { exerciseFocuses, exerciseFocusLinks, exercises } from "@/db/schema";
import { EXERCISE_CATEGORY_LABELS, EXERCISE_CATEGORY_ORDER, getExerciseWorkoutRows, type ExerciseWorkoutRow } from "@/lib/charts";
import { categoricalColor } from "@/lib/viz/color";
import { rankCreditedSessions, type Credit, type CreditedSession } from "@/lib/leaderboards/sessions";
import type { LeaderboardColumns, LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// The exercise leaderboard (#115): time spent training, ranked by
// exercise, by focus, or by category. Hours come from
// `getExerciseWorkoutRows`, which already resolves a workout's time from
// its own duration or, failing that, its sets' — the same numbers the
// Exercise Mix and Training Volume charts use.

export type ExerciseMode = "exercise" | "focus" | "category";

export const EXERCISE_MODES: LeaderboardOption<ExerciseMode>[] = [
  { id: "exercise", label: "Exercises" },
  { id: "focus", label: "Focuses" },
  { id: "category", label: "Categories" },
];

/** Category colour by its fixed slot in `EXERCISE_CATEGORY_ORDER` — the
 * same assignment Training Volume makes, so a category is one colour
 * everywhere it appears. */
function categoryColor(category: string): string | null {
  const index = (EXERCISE_CATEGORY_ORDER as readonly string[]).indexOf(category);
  return index >= 0 ? categoricalColor(index) : null;
}

/**
 * Ranks training hours under one mode.
 *
 * An exercise that trains several focuses credits each in full — an hour
 * of rowing is an hour of both cardio and back work, not half of each.
 * An exercise with no focus linked drops out of focus mode rather than
 * ranking as "none".
 */
export function buildExerciseLeaderboard(
  workouts: ExerciseWorkoutRow[],
  focusesByExercise: Map<number, string[]>,
  mode: ExerciseMode,
): LeaderboardRow[] {
  const credited: CreditedSession[] = workouts.map((w) => {
    const label = EXERCISE_CATEGORY_LABELS[w.category] ?? w.category;
    let credits: Credit[];
    switch (mode) {
      case "exercise":
        credits = [
          { key: String(w.exerciseId), name: w.exerciseName, context: label, color: categoryColor(w.category) },
        ];
        break;
      case "focus":
        credits = (focusesByExercise.get(w.exerciseId) ?? []).map((focus) => ({ key: focus, name: focus }));
        break;
      case "category":
        credits = [{ key: w.category, name: label, color: categoryColor(w.category) }];
        break;
    }
    return { date: w.date, hours: w.hours, credits };
  });
  return rankCreditedSessions(credited);
}

export function exerciseColumns(mode: ExerciseMode): LeaderboardColumns {
  const base = {
    valueHeader: "Time",
    valueDescription: "Total training time.",
    valueFormat: "hours" as const,
    countHeader: "Sessions",
    gainedNoun: "time gained",
  };
  switch (mode) {
    case "exercise":
      return { ...base, nameHeader: "Exercise", contextHeader: "Category" };
    case "focus":
      return {
        ...base,
        nameHeader: "Focus",
        valueDescription: "Training time on exercises with this focus. An exercise with several focuses counts toward each.",
      };
    case "category":
      return { ...base, nameHeader: "Category" };
  }
}

export async function getExerciseLeaderboardData(mode: ExerciseMode): Promise<LeaderboardRow[]> {
  const db = getDb();
  const [workouts, links] = await Promise.all([
    getExerciseWorkoutRows(),
    db
      .selectDistinct({ exerciseId: exercises.id, focus: exerciseFocuses.name })
      .from(exerciseFocusLinks)
      .innerJoin(exercises, eq(exerciseFocusLinks.exerciseId, exercises.id))
      .innerJoin(exerciseFocuses, eq(exerciseFocusLinks.focusId, exerciseFocuses.id)),
  ]);
  const focusesByExercise = new Map<number, string[]>();
  for (const link of links) {
    focusesByExercise.set(link.exerciseId, [...(focusesByExercise.get(link.exerciseId) ?? []), link.focus]);
  }
  return buildExerciseLeaderboard(workouts, focusesByExercise, mode);
}
