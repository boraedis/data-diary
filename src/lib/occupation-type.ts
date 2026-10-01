import type { OccupationType } from "@/db/schema";

// What a profile occupation entry is (#560). Pure, so the editor (client)
// and the recap/leaderboard (server) share one set of labels and one rule
// for what counts as work.

export const OCCUPATION_TYPE_LABELS: Record<OccupationType, string> = {
  work: "Work",
  education: "Education",
};

/** Whether an entry counts as a job. The work breakdown credits days and
 * hours only to these: a school day is not a day worked, so letting it
 * share the credit would inflate every job's totals. */
export function isWork(entry: { type: OccupationType }): boolean {
  return entry.type === "work";
}
