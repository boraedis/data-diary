/**
 * Per-field methodology copy for the `ChartInfo` popup's "Methodology"
 * section (#316, the content follow-up to #315's chart-page shell rework).
 *
 * One constant per *underlying field*, not per chart — every chart built
 * on the same logged field (e.g. every happiness chart) shares the exact
 * same methodology, since the methodology question is "what does this
 * number actually mean," which doesn't change with how a given chart
 * slices or buckets it. Written in first person: this is the app owner
 * explaining their own data-entry habits, not a generic product
 * description.
 */

export const HAPPINESS_METHODOLOGY =
  "Happiness is self-rated on a 0–100% scale, logged once a day to capture how the day felt overall. It's inherently subjective, but a decade of consistent tracking has given the number a fairly calibrated sense of my own baseline. I like to think of myself as a generally happy person who also tries to stay mindful of the everyday privileges I have, so most \"normal\" days land somewhere around 80–90%, with lower scores reserved for days that were genuinely harder than usual.";

export const DAY_TYPE_METHODOLOGY =
  "Every day is classified into one of six categories: Work (any day with significant work on my occupation, school included), Day off (not working and not traveling — a weekend or holiday spent at home), Vacation (away from home on some kind of trip), Travel (a day spent primarily getting somewhere, like a full day of flights, trains, or driving), Sick (a day significantly affected by being unwell), and Jobless (a day off during a stretch of unemployment, distinct from an ordinary day off).";
