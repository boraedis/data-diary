import { formatDate } from "@/lib/viz/format";

/**
 * Per-field "Tracked since" copy for the `ChartInfo` popup — the exact day a
 * logged field started being recorded, and, where applicable, the day it
 * stopped. One constant per underlying field, same split as
 * `methodology.ts`: the question "when did this start" doesn't change with
 * how a given chart slices or buckets the field.
 *
 * `end` is expected to stay unset for essentially every field in this
 * version of the app — unlike the legacy app, nothing here has been
 * retired mid-history.
 */
export interface TrackingSpan {
  /** The first day this field was recorded, "YYYY-MM-DD". */
  start: string;
  /** The last day this field was recorded, only set for a retired field. */
  end?: string;
}

/** Shown in place of a real `TrackingSpan` until one has been supplied. */
export const PLACEHOLDER_TRACKING_SPAN = "Not yet recorded.";

/** Formats a `TrackingSpan` for display: the exact start day, or a start–end
 * range for the rare retired field. */
export function formatTrackingSpan(span: TrackingSpan): string {
  const start = formatDate(span.start, "dayYear");
  if (!span.end) return start;
  return `${start} – ${formatDate(span.end, "dayYear")} (retired)`;
}
