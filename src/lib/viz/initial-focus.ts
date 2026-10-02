/**
 * Where a zoomable time chart should open, and what to animate from/to.
 * Pure resolution only — the tween itself is `useInitialFocus`
 * (`src/hooks/use-initial-focus.ts`). Same split as `bin.ts`/`timeline.ts`:
 * the maths is testable without a DOM.
 *
 * Legacy opened its scrollers on a `startWindow` of the last N points and
 * (for sleep) animated into it from the full extent over three seconds, so
 * a reader first sees how much history exists and then lands on the recent
 * stretch. `lastDays` is that, in days rather than points: every consumer
 * here is a daily log, and a day count means the same thing to a chart that
 * has gaps.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Long enough to read as a deliberate zoom rather than a jump, short
 * enough not to hold up someone who wants to look at the chart. Legacy's
 * sleep chart used 3000; that stays a per-chart override. */
export const DEFAULT_FOCUS_DURATION_MS = 1500;

/** Where every scroller opens unless told otherwise: the last three months.
 * Short enough that individual days are readable (a daily log is thousands
 * of points, a sliver each at full extent), long enough to show a trend.
 * Data shorter than this just opens on everything, with no animation. */
export const DEFAULT_INITIAL_FOCUS: InitialFocus = { lastDays: 90 };

export type InitialFocus = {
  /** Animation length. 0 (or a reduced-motion preference) jumps straight
   * to the window. */
  durationMs?: number;
} & ({ lastDays: number } | { domain: readonly [Date, Date] });

/** The window to zoom to, clamped inside `full`, or null when there is
 * nothing to zoom to — the target covers (or exceeds) everything, is
 * empty, or the data itself is a single instant. */
export function resolveInitialFocus(full: readonly [Date, Date], focus: InitialFocus): [Date, Date] | null {
  const full0 = full[0].getTime();
  const full1 = full[1].getTime();
  if (!(full1 > full0)) return null;

  let start: number;
  let end: number;
  if ("lastDays" in focus) {
    if (!(focus.lastDays > 0)) return null;
    end = full1;
    start = end - focus.lastDays * DAY_MS;
  } else {
    start = focus.domain[0].getTime();
    end = focus.domain[1].getTime();
  }

  start = Math.max(start, full0);
  end = Math.min(end, full1);
  if (!(end > start)) return null;
  if (start <= full0 && end >= full1) return null;
  return [new Date(start), new Date(end)];
}

/** The window `t` of the way from `from` to `to` (t already eased).
 * Endpoints interpolate independently, which is what d3-zoom's own
 * `scaleTo` transition does visually and keeps the animation smooth when
 * the target hugs one edge of the data. */
export function lerpDomain(from: readonly [Date, Date], to: readonly [Date, Date], t: number): [Date, Date] {
  const mix = (a: Date, b: Date) => new Date(a.getTime() + (b.getTime() - a.getTime()) * t);
  return [mix(from[0], to[0]), mix(from[1], to[1])];
}
