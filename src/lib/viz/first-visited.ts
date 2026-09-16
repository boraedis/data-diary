// Pure formatting for a choropleth region's first-visit tooltip row (#370)
// — split out from the chart components the same way hierarchy.ts and
// bin.ts sit beside the primitives that call them, so the wording lives
// in one place rather than being reimplemented per chart.

import { formatDate } from "@/lib/viz/format";

/**
 * "First visited Mar 2016" for a logged region's earliest day, or "First
 * logged Mar 2016" once that earliest day lands at or before the diary's
 * own start. Those are different claims: a first-logged date sitting
 * right at the diary's start is exactly what truncation looks like (the
 * place could well have been visited earlier, just never logged that far
 * back), so asserting it as the actual first visit would overstate what
 * the data supports.
 *
 * Coarse month/year, not a full date — first-visit is already the
 * coarsest fact a region's tooltip shows, and the diary's own start date
 * bounds how precise this can honestly be regardless.
 */
export function formatFirstVisited(dateStr: string, diaryStartDate: string | null): string {
  const label = diaryStartDate != null && dateStr <= diaryStartDate ? "First logged" : "First visited";
  return `${label} ${formatDate(dateStr, "monthYear")}`;
}

/**
 * Same row, for an unlogged-travel entry's own `first_visited` (#323/
 * #363) — always "visited" wording, never "logged", since these entries
 * are true by definition of having no `days` rows behind them at all.
 *
 * `first_visited` is nullable by design (most of this travel predates the
 * diary and was typed in from memory), so a null date says so explicitly
 * rather than the row silently disappearing — a missing row and "unknown"
 * read very differently when the whole point of the row is spotting a
 * gap. A lot of the seeded #323 counties will be in exactly this state.
 */
export function formatTravelledFirstVisited(dateStr: string | null): string {
  return dateStr ? `First visited ${formatDate(dateStr, "monthYear")}` : "First visited date unknown";
}
