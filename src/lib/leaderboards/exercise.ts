import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { exerciseFocuses, exerciseFocusLinks, exercises, exerciseSubfocuses } from "@/db/schema";
import { EXERCISE_CATEGORY_COLORS, EXERCISE_CATEGORY_LABELS, getExerciseWorkoutRows, type ExerciseWorkoutRow } from "@/lib/charts";
import { formatTitleCase } from "@/lib/viz/format";
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

export type FocusLevel = "focus" | "subfocus";

export const FOCUS_LEVELS: LeaderboardOption<FocusLevel>[] = [
  { id: "focus", label: "Focus" },
  { id: "subfocus", label: "Subfocus" },
];

/** One focus an exercise trains, with its subfocus where the link has
 * one. Names are title-cased here — the catalog stores most lowercase. */
export type ExerciseFocus = { focus: string; subfocus: string | null };

function categoryColor(category: string): string | null {
  return EXERCISE_CATEGORY_COLORS[category] ?? null;
}

/**
 * Ranks training hours under one mode.
 *
 * An exercise that trains several focuses (or subfocuses) credits each in
 * full — an hour of rowing is an hour of both cardio and back work, not
 * half of each. An exercise with none linked drops out of that mode
 * rather than ranking as "none". Subfocuses are keyed with their focus,
 * since two focuses could share a subfocus name.
 */
export function buildExerciseLeaderboard(
  workouts: ExerciseWorkoutRow[],
  focusesByExercise: Map<number, ExerciseFocus[]>,
  mode: ExerciseMode,
  level: FocusLevel = "focus",
): LeaderboardRow[] {
  const credited: CreditedSession[] = workouts.map((w) => {
    const label = EXERCISE_CATEGORY_LABELS[w.category] ?? w.category;
    const focuses = focusesByExercise.get(w.exerciseId) ?? [];
    let credits: Credit[];
    switch (mode) {
      case "exercise":
        credits = [
          { key: String(w.exerciseId), name: w.exerciseName, context: label, color: categoryColor(w.category) },
        ];
        break;
      case "focus":
        credits =
          level === "focus"
            ? focuses.map((f) => ({ key: f.focus, name: f.focus }))
            : focuses
                .filter((f) => f.subfocus !== null)
                .map((f) => ({ key: `${f.focus}\u0000${f.subfocus}`, name: f.subfocus as string, detail: f.focus }));
        break;
      case "category":
        credits = [{ key: w.category, name: label, color: categoryColor(w.category) }];
        break;
    }
    return { date: w.date, hours: w.hours, credits };
  });
  return rankCreditedSessions(credited);
}

export function exerciseColumns(mode: ExerciseMode, level: FocusLevel = "focus"): LeaderboardColumns {
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
        nameHeader: level === "focus" ? "Focus" : "Subfocus",
        valueDescription: `Training time on exercises with this ${level}. An exercise with several counts toward each.`,
      };
    case "category":
      return { ...base, nameHeader: "Category" };
  }
}

export async function getExerciseLeaderboardData(
  mode: ExerciseMode,
  level: FocusLevel = "focus",
): Promise<LeaderboardRow[]> {
  const db = getDb();
  const [workouts, links] = await Promise.all([
    getExerciseWorkoutRows(),
    db
      .selectDistinct({ exerciseId: exercises.id, focus: exerciseFocuses.name, subfocus: exerciseSubfocuses.name })
      .from(exerciseFocusLinks)
      .innerJoin(exercises, eq(exerciseFocusLinks.exerciseId, exercises.id))
      .innerJoin(exerciseFocuses, eq(exerciseFocusLinks.focusId, exerciseFocuses.id))
      .leftJoin(exerciseSubfocuses, eq(exerciseFocusLinks.subfocusId, exerciseSubfocuses.id)),
  ]);
  const focusesByExercise = new Map<number, ExerciseFocus[]>();
  for (const link of links) {
    const list = focusesByExercise.get(link.exerciseId) ?? [];
    list.push({
      focus: formatTitleCase(link.focus),
      subfocus: link.subfocus ? formatTitleCase(link.subfocus) : null,
    });
    focusesByExercise.set(link.exerciseId, list);
  }
  return buildExerciseLeaderboard(workouts, focusesByExercise, mode, level);
}
