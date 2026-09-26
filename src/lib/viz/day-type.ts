import type { DayType } from "@/db/schema";
import { categoricalColor } from "@/lib/viz/color";

// Day-type order, labels and colour, shared by every chart that encodes
// `days.dayType` — the Day Types calendar, the Work charts' grouping, and
// the Sleep Hours bars (#212). These used to be defined twice (in
// mood-charts.tsx and work.ts); a third copy for sleep was the point at
// which a type could quietly end up a different colour on different pages.

/**
 * Day types, ordered by how often they occur.
 *
 * Order matters because it decides colour: `categoricalColor` has five real
 * slots before it flattens to one muted grey for everything beyond, and
 * there are six day types. Ranking by frequency means the grey lands on the
 * rarest — `sick`, five days in the whole history — rather than on
 * something you'd actually want to pick out.
 *
 * Fixed rather than derived from the data so a type's colour doesn't shift
 * when the visible range changes.
 */
export const DAY_TYPE_ORDER: readonly DayType[] = ["work", "dayoff", "vacation", "travel", "jobless", "sick"];

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  work: "Work",
  dayoff: "Day off",
  vacation: "Vacation",
  travel: "Travel",
  jobless: "Jobless",
  sick: "Sick",
};

export function dayTypeColor(dayType: string): string {
  const index = DAY_TYPE_ORDER.indexOf(dayType as DayType);
  return categoricalColor(index === -1 ? DAY_TYPE_ORDER.length : index);
}
