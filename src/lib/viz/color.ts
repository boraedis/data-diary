import { scaleDiverging, scaleSequential, scaleSequentialLog, interpolateHcl } from "d3";
import type { ScaleDiverging, ScaleSequential } from "d3";

// Shared color-system helpers (#16's "color system" scope item). Every
// Interactive* primitive should reach for these instead of a hand-rolled
// `d3.scaleSequential(d3.interpolateRgb(...))` the way
// sleep-calendar-chart.tsx does today (a one-off teal ramp unrelated to
// --chart-1..5) — this module is the fix for that going forward.
//
// Categorical color is assigned by fixed slot order, never
// generated/cycled (see the dataviz skill's non-negotiables) — a filter
// that drops a series must not repaint the survivors, and a 6th+ series
// folds into "Other"/small-multiples/composite encoding rather than a new
// hue. The --chart-1..5 tokens themselves (globals.css) were re-stepped
// and validated for colorblind-safety as part of #16 — see that commit's
// PR description for the validate_palette.js pass/fail record.

export type ColorMode = "light" | "dark";

const CATEGORICAL_SLOT_COUNT = 5;

/**
 * Fixed-order categorical color for series index `i` (0-based), resolving
 * to the `--chart-1..5` CSS custom properties so it automatically tracks
 * light/dark mode the same way every existing chart's `var(--chart-1)`
 * `.attr("fill", ...)` call already does — this just centralizes "index ->
 * var name" instead of leaving every call site to write `chart-${i + 1}`
 * by hand and risk off-by-one slot reuse.
 *
 * There is no 6th slot: per the dataviz skill's rule, a series beyond the
 * fixed set is never a generated/cycled hue. Fold it into "Other," a small
 * multiple, or a composite encoding *before* calling this — index 5+
 * returns a muted neutral specifically so an uncaught overflow reads as
 * "this isn't a real series slot," not as a silently-repeated color.
 */
export function categoricalColor(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`categoricalColor: index must be a non-negative integer, got ${index}`);
  }
  if (index >= CATEGORICAL_SLOT_COUNT) {
    return "var(--muted-foreground)";
  }
  return `var(--chart-${index + 1})`;
}

// Sequential and diverging scales need real interpolatable colors (d3's
// interpolators operate on parsed color values, not CSS `var()` strings),
// so — unlike categoricalColor — these two ship their own small fixed
// ramps rather than reading globals.css tokens live. Anchored to the same
// hue families as the categorical palette (terracotta = chart-1's hue,
// dusty teal = chart-5's hue) so a sequential/diverging fill still reads
// as "this app's own colors," matching the categorical palette's earthy
// identity rather than a borrowed generic blue ramp.

const SEQUENTIAL_ENDPOINTS: Record<ColorMode, [string, string]> = {
  // oklch(0.93 0.035 40) -> oklch(0.68 0.18 40): pale terracotta tint (near
  // zero recedes toward the light surface) to the same saturated
  // terracotta as light-mode chart-1.
  light: ["#fee1d7", "#f16935"],
  // oklch(0.26 0.035 40) -> oklch(0.78 0.16 40): near-surface dark tint to
  // a brighter terracotta than dark-mode chart-1, so the "hot" end still
  // stands out against the dark card surface.
  dark: ["#331e17", "#ff9064"],
};

/**
 * One-hue, light->dark scale for magnitude (heatmap fills, calendar
 * cells) — see the dataviz skill's color-formula rule: sequential is
 * always a single hue, never a rainbow. `domain` is the data's `[min,
 * max]`; returns a d3 scale (callable as `scale(value)`, and chainable
 * via `.domain()`/`.clamp()` like any `scaleSequential`).
 */
export function sequentialScale(domain: [number, number], mode: ColorMode = "light"): ScaleSequential<string> {
  const [low, high] = SEQUENTIAL_ENDPOINTS[mode];
  return scaleSequential(interpolateHcl(low, high)).domain(domain);
}

/**
 * Same one-hue ramp as `sequentialScale`, but log-distributed rather than
 * linear — for a heavy-tailed magnitude metric (a choropleth where one or
 * two regions dwarf the rest) where a linear domain crushes every smaller
 * value into visually the same color, leaving only the single largest
 * region distinguishable. `domain` must be strictly positive (a log scale
 * has no representation for 0 or negative values) — filter those out
 * before computing the domain, same as any `d3.scaleLog` caller has to.
 */
export function sequentialLogScale(domain: [number, number], mode: ColorMode = "light"): ScaleSequential<string> {
  const [low, high] = SEQUENTIAL_ENDPOINTS[mode];
  return scaleSequentialLog(interpolateHcl(low, high)).domain(domain);
}

const DIVERGING_ENDPOINTS: Record<ColorMode, { cool: string; warm: string; neutral: string }> = {
  // Cool pole = dusty-teal family (chart-5's hue, 225°); warm pole =
  // terracotta family (chart-1's hue, 40°) — this app's own warm/cool
  // poles in place of the generic blue<->red pair, same "opposite hues,
  // neutral midpoint" structure.
  light: { cool: "#00719e", warm: "#ae3200", neutral: "#e0ddda" },
  dark: { cool: "#4fb8e6", warm: "#ff8a4d", neutral: "#312d2a" },
};

/**
 * Two-hue-plus-neutral-midpoint scale for polarity (a value that's above
 * or below a meaningful baseline — net happiness swing, budget over/under,
 * etc.). `domain` is `[min, mid, max]`, matching `d3.scaleDiverging`'s own
 * three-point domain convention; pass the baseline as `mid` (usually 0,
 * but not assumed to be — a diverging domain's midpoint is whatever value
 * means "neither side").
 */
export function divergingScale(
  domain: [number, number, number],
  mode: ColorMode = "light",
): ScaleDiverging<string> {
  const { cool, warm, neutral } = DIVERGING_ENDPOINTS[mode];
  // d3's diverging interpolator is called with t in [0, 1] where 0.5 is
  // the midpoint — build it as two half-ramps (cool->neutral,
  // neutral->warm) rather than a single three-stop interpolator, since
  // d3-interpolate has no built-in 3-color interpolator.
  const interpolator = (t: number): string =>
    t <= 0.5 ? interpolateHcl(cool, neutral)(t * 2) : interpolateHcl(neutral, warm)((t - 0.5) * 2);
  return scaleDiverging<string>(interpolator).domain(domain);
}
