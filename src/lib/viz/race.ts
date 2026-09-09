import type { RankedEntry } from "@/components/charts/interactive/interactive-ranked";

// Pure frame/ranking math for the bar race (#103) — the half of
// InteractiveBarRace that has nothing to do with D3, React or the DOM, so
// it can be unit-tested without a jsdom pass (same split as viz/bin.ts and
// viz/hierarchy.ts: reshaping rows a caller already has, never fetching or
// aggregating a chart's full history itself).
//
// Legacy's BarRace (functions/views/vis/vis_functions.js:5147) built a
// fixed list of *keyframes* up front — for every adjacent pair of dates it
// pushed `k = 3` interpolated snapshots, then `await`ed a 180ms d3
// transition per keyframe in a `for` loop, which is why it had no pause,
// no scrub and no way to stop short of navigating away. This module
// replaces that with a continuous position: `interpolateStandings` answers
// "what does the ranking look like at fractional frame 12.4" for any
// position the caller asks for, so playback is just a clock driving a
// number, and scrubbing is that same number coming from a slider instead.

/** One period's standings, pre-aggregated by the caller. */
export type RaceFrame = {
  /** The moment this frame represents — used for the ticker and, when the
   * caller supplies one, the scrub readout. */
  date: Date;
  /** Everyone with a value in this period. Entries missing from a frame
   * are treated as zero there rather than as absent, so a bar animates
   * down to the baseline instead of vanishing mid-flight. */
  entries: RankedEntry[];
};

/** One bar at one instant: an interpolated value plus the rank it sorts
 * to. `rank` is a float-free integer position (0 = leader) that the
 * primitive turns into a y coordinate. */
export type RaceStanding = {
  label: string;
  value: number;
  rank: number;
};

/**
 * Every label that appears anywhere in the race, in first-appearance
 * order.
 *
 * First-appearance rather than alphabetical or by-total on purpose: it's
 * the order a caller's `categoricalColor(i)`-style color callback will see,
 * and this app's palette is assigned by fixed slot order and never
 * recycled (see viz/color.ts). Stable input order in, stable colors out.
 */
export function raceLabels(frames: RaceFrame[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const frame of frames) {
    for (const entry of frame.entries) {
      if (seen.has(entry.label)) continue;
      seen.add(entry.label);
      out.push(entry.label);
    }
  }
  return out;
}

/**
 * The standings at a fractional frame `position`.
 *
 * `position` is in frame units — 3 is exactly frame 3, 3.5 is halfway
 * between frames 3 and 4 — and is clamped to the available range, so a
 * caller's clock overshooting the end simply parks on the last frame.
 * Values interpolate linearly between the two neighboring frames (legacy's
 * own `(1 - t) * a + t * b`, just continuous instead of quantized to
 * thirds), and rank is recomputed from the *interpolated* values, which is
 * what makes a lead change read as two bars crossing rather than swapping
 * places instantly.
 *
 * Ties break by label so a frame's output is deterministic — without it,
 * two entries level on value could swap rank frame to frame purely from
 * sort instability, and the bars would jitter while standing still.
 */
export function interpolateStandings(frames: RaceFrame[], position: number): RaceStanding[] {
  if (frames.length === 0) return [];

  const clamped = Math.min(Math.max(position, 0), frames.length - 1);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, frames.length - 1);
  const t = clamped - lower;

  const values = new Map<string, number>();
  for (const entry of frames[lower].entries) {
    values.set(entry.label, entry.value * (1 - t));
  }
  if (t > 0) {
    for (const entry of frames[upper].entries) {
      values.set(entry.label, (values.get(entry.label) ?? 0) + entry.value * t);
    }
  }

  return [...values.entries()]
    .map(([label, value]) => ({ label, value, rank: 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .map((standing, index) => ({ ...standing, rank: index }));
}

/**
 * The date at a fractional frame `position`, interpolated the same way the
 * values are — so the ticker sweeps through the period between two frames
 * instead of jumping a month at a time while the bars move smoothly.
 */
export function interpolateDate(frames: RaceFrame[], position: number): Date | null {
  if (frames.length === 0) return null;
  const clamped = Math.min(Math.max(position, 0), frames.length - 1);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, frames.length - 1);
  const t = clamped - lower;
  const a = frames[lower].date.getTime();
  const b = frames[upper].date.getTime();
  return new Date(a * (1 - t) + b * t);
}

/**
 * The x-axis maximum at a fractional position: the leader's own value,
 * with a floor of 1 so an all-zero opening frame still has a usable scale.
 *
 * Rescaling to the leader every frame is legacy's behaviour
 * (`xScale.domain([0, keyframe[1][0].value])`) and the Observable original's
 * too. It's deliberate: a race whose axis is pinned to the *final* maximum
 * spends its first half as five stubs against an empty plot. The cost is
 * that bar lengths aren't comparable across time — which is why the axis
 * itself stays on screen with real ticks, and why the value label rides
 * every bar, rather than asking the reader to judge length alone.
 */
export function leaderValue(standings: RaceStanding[]): number {
  return Math.max(1, standings[0]?.value ?? 0);
}
