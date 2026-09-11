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
 *
 * Dates below are computed (`MIN(date)`/`MIN(start)` per field against the
 * real data, not recalled from memory), except the three life-timeline
 * tables — see `LIFE_TRACKING_SPAN`'s own comment.
 */
export interface TrackingSpan {
  /** The first day this field was recorded, "YYYY-MM-DD". */
  start: string;
  /** The last day this field was recorded, only set for a retired field. */
  end?: string;
  /** An extra caveat shown alongside the date — e.g. when the *feature*
   * postdates the history it records, as `LIFE_TRACKING_SPAN` does. */
  note?: string;
}

/** Shown in place of a real `TrackingSpan` until one has been supplied. */
export const PLACEHOLDER_TRACKING_SPAN = "Not yet recorded.";

/** Formats a `TrackingSpan` for display: the exact start day, or a start–end
 * range for the rare retired field, plus its `note` on its own line. */
export function formatTrackingSpan(span: TrackingSpan): string {
  const start = formatDate(span.start, "dayYear");
  const range = span.end ? `${start} – ${formatDate(span.end, "dayYear")} (retired)` : start;
  return span.note ? `${range}\n${span.note}` : range;
}

export const HAPPINESS_TRACKING_SPAN: TrackingSpan = { start: "2016-02-18" };

export const DAY_TYPE_TRACKING_SPAN: TrackingSpan = { start: "2020-01-01" };

export const SLEEP_TRACKING_SPAN: TrackingSpan = { start: "2019-06-04" };

/** Matches `SLEEP_LOCATION_METHODOLOGY`'s own note that this wasn't tracked
 * before mid-2023. */
export const SLEEP_LOCATION_TRACKING_SPAN: TrackingSpan = { start: "2023-08-10" };

export const COFFEE_TRACKING_SPAN: TrackingSpan = { start: "2023-08-19" };

export const DISTANCE_TRACKING_SPAN: TrackingSpan = { start: "2016-02-18" };

export const WEIGHT_TRACKING_SPAN: TrackingSpan = { start: "2018-01-09" };

export const TRAINING_TRACKING_SPAN: TrackingSpan = { start: "2022-11-11" };

/** Phone and laptop usage only — Instagram usage minutes started much
 * later (see `INSTAGRAM_USAGE_TRACKING_SPAN`) and isn't plotted by any
 * chart on this span yet anyway (#326). */
export const SCREEN_TIME_TRACKING_SPAN: TrackingSpan = { start: "2018-03-20" };

/** Not currently wired to any chart — Instagram usage minutes are tracked
 * but not plotted anywhere yet (#326). Kept here so wiring it in later is
 * a one-line change once that ships. */
export const INSTAGRAM_USAGE_TRACKING_SPAN: TrackingSpan = { start: "2025-01-01" };

/** Follower/following counts — a different, much earlier start than
 * Instagram *usage* minutes above. */
export const INSTAGRAM_TRACKING_SPAN: TrackingSpan = { start: "2018-07-28" };

export const PLACES_TRACKING_SPAN: TrackingSpan = { start: "2016-02-18" };

export const PEOPLE_TRACKING_SPAN: TrackingSpan = { start: "2016-06-02" };

/** The earliest *start* date recorded across occupations, residences, and
 * relationships — real personal history, not a placeholder. The life
 * timeline feature itself (#310) only shipped in 2023, well after that
 * history began; every entry further back than its build date was
 * reconstructed afterward from memory for significant, clearly-dated life
 * events, not logged day-by-day the way every other chart's data is. */
export const LIFE_TRACKING_SPAN: TrackingSpan = {
  start: "2023-02-18",
  note: "Backfilled from memory for significant life events, not logged day-by-day like the rest of this app's data.",
};
