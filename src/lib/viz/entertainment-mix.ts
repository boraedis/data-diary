import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { parseDate } from "@/lib/date";
import { ENTERTAINMENT_TYPE_ORDER, type EntertainmentType } from "@/lib/entertainment-types";
import type { EntertainmentDay } from "@/lib/charts";

// The pure re-bucketing behind the Entertainment Mix stacked area (#222):
// the same boundary as bin.ts, reshaping days the page already fetched.

export type EntertainmentMixPoint = { x: Date; values: Record<EntertainmentType, number> };

/**
 * One point per period: each medium's **average hours per day** across the
 * period, the call Entertainment Trend (#479) and Exercise Trend (#411)
 * made, so a 31-day and a 28-day month with identical habits stack to the
 * same height. The series is zero-filled daily, so every day in the period
 * is in the divisor — "time per calendar day", not "per day something was
 * watched". The final, partial period divides by the days it actually has.
 *
 * The bands sum to the total because each day's types partition it: unlike
 * music genres, a session belongs to exactly one medium.
 */
export function buildEntertainmentMixPoints(days: EntertainmentDay[], period: Period): EntertainmentMixPoint[] {
  return groupByPeriod(days, period, (d) => d.date).map(({ start, items }) => {
    const values = Object.fromEntries(ENTERTAINMENT_TYPE_ORDER.map((t) => [t, 0])) as Record<EntertainmentType, number>;
    for (const day of items) for (const t of ENTERTAINMENT_TYPE_ORDER) values[t] += day[t];
    for (const t of ENTERTAINMENT_TYPE_ORDER) values[t] /= items.length;
    return { x: parseDate(start), values };
  });
}
