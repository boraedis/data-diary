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
// "what does the board look like at fractional frame 12.4" for any
// position the caller asks for, so playback is just a clock driving a
// number, and scrubbing is that same number coming from a slider instead.
//
// **Rank is interpolated, not recomputed.** This is what makes two bars
// slide past each other on a lead change instead of teleporting between
// rows. Ranking the *interpolated values* would give an integer rank that
// flips the instant one bar's value passes another's — the crossing would
// be a jump-cut. So each frame's ranking is computed once up front
// (`buildRaceIndex`) and the rank a bar is *drawn* at is a fractional
// blend of its rank in the two neighboring frames, exactly the quantity
// legacy's d3 transitions were tweening between keyframes.

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

/** One bar at one instant. `rank` is fractional while a swap is in
 * progress (0 = leader) — the primitive turns it straight into a y
 * coordinate. */
export type RaceStanding = {
  label: string;
  value: number;
  rank: number;
};

/**
 * Frames with every label's rank resolved, ready to interpolate between.
 *
 * Built once per frame set rather than per animation frame: ranking every
 * label in every frame is O(frames x labels log labels), fine once at
 * mount and far too much to redo 60 times a second.
 */
export type RaceIndex = {
  /** Every label in the race, in first-appearance order. */
  labels: string[];
  dates: Date[];
  /** Per frame, every label's value and integer rank in that frame.
   * Labels missing from a frame are present here with value 0, ranked
   * below everyone who scored — a bar has to have a position to come from
   * even in the frames before it exists. */
  frames: Map<string, RaceStanding>[];
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
 * Ranks every label in every frame, once.
 *
 * Ties break by label so a frame's ranking is deterministic — without it,
 * two entries level on value could swap rank purely from sort instability,
 * and the bars would drift past each other while standing still.
 */
export function buildRaceIndex(frames: RaceFrame[]): RaceIndex {
  const labels = raceLabels(frames);
  return {
    labels,
    dates: frames.map((frame) => frame.date),
    frames: frames.map((frame) => {
      const values = new Map(frame.entries.map((entry) => [entry.label, entry.value]));
      const ranked = labels
        .map((label) => ({ label, value: values.get(label) ?? 0 }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      return new Map(ranked.map((entry, rank) => [entry.label, { ...entry, rank }]));
    }),
  };
}

/**
 * Smoothstep, applied to the *rank* blend only.
 *
 * A linear rank blend means a bar is between rows for the whole period
 * between two frames, so on a board with near-ties several bars are
 * drifting through each other at any given instant and the rows never
 * look settled. Easing the blend keeps a bar on its row for most of the
 * period and spends the swap in the middle of it — the crossing becomes a
 * deliberate movement rather than a constant slow drift. Values stay
 * linear: a value is a real quantity being interpolated, and easing it
 * would make the numbers lie.
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The board at a fractional frame `position`, ordered by drawn rank.
 *
 * `position` is in frame units — 3 is exactly frame 3, 3.5 is halfway
 * between frames 3 and 4 — and is clamped to the available range, so a
 * caller's clock overshooting the end simply parks on the last frame.
 * Values blend linearly between the two neighboring frames (legacy's own
 * `(1 - t) * a + t * b`, just continuous instead of quantized to thirds);
 * rank blends through `smoothstep` — see above for why the two differ.
 *
 * `limit` caps how many standings come back, counting from the leader —
 * pass the number of rows actually drawn (plus the one below the cut a
 * climbing bar rises from). Everyone below that is still ranked and still
 * interpolated; they're simply not returned, so a race over hundreds of
 * labels costs the same per frame as one over a dozen.
 */
export function interpolateStandings(
  index: RaceIndex,
  position: number,
  limit?: number,
): RaceStanding[] {
  if (index.frames.length === 0) return [];

  const clamped = Math.min(Math.max(position, 0), index.frames.length - 1);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, index.frames.length - 1);
  const t = clamped - lower;
  const rankT = smoothstep(t);
  const a = index.frames[lower];
  const b = index.frames[upper];

  const standings = index.labels.map((label) => {
    const from = a.get(label);
    const to = b.get(label);
    // Both are always present — buildRaceIndex ranks every label in every
    // frame — but the fallbacks keep this honest if an index is ever built
    // by hand.
    const start = from ?? { label, value: 0, rank: index.labels.length };
    const end = to ?? start;
    return {
      label,
      value: start.value * (1 - t) + end.value * t,
      rank: start.rank * (1 - rankT) + end.rank * rankT,
    };
  });

  standings.sort((x, y) => x.rank - y.rank);
  return limit === undefined ? standings : standings.slice(0, limit);
}

/**
 * The date at a fractional frame `position`, interpolated the same way the
 * values are — so the ticker sweeps through the period between two frames
 * instead of jumping a month at a time while the bars move smoothly.
 */
export function interpolateDate(index: RaceIndex, position: number): Date | null {
  if (index.dates.length === 0) return null;
  const clamped = Math.min(Math.max(position, 0), index.dates.length - 1);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, index.dates.length - 1);
  const t = clamped - lower;
  const a = index.dates[lower].getTime();
  const b = index.dates[upper].getTime();
  return new Date(a * (1 - t) + b * t);
}

/**
 * The x-axis maximum for a set of standings: the largest value in it, with
 * a floor of 1 so an all-zero opening frame still has a usable scale.
 *
 * The largest *value*, not the top-ranked bar's — mid-swap the two aren't
 * the same bar, and keying the axis off rank would make it flinch every
 * time a lead changed.
 *
 * Rescaling to the leader every frame is legacy's behaviour
 * (`xScale.domain([0, keyframe[1][0].value]`) and the Observable original's
 * too. It's deliberate: a race whose axis is pinned to the *final* maximum
 * spends its first half as five stubs against an empty plot. The cost is
 * that bar lengths aren't comparable across time — which is why the axis
 * itself stays on screen with real ticks, and why the value label rides
 * every bar, rather than asking the reader to judge length alone.
 */
export function leaderValue(standings: RaceStanding[]): number {
  let max = 1;
  for (const standing of standings) max = Math.max(max, standing.value);
  return max;
}
