import { color, scaleDiverging, scaleSequential, scaleSequentialLog, interpolateHcl } from "d3";
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

// The dark low end used to sit at oklch L 0.26 — barely a step off dark
// `--muted` (L 0.25), so a region with exactly one logged day was
// colorimetrically indistinguishable from one with none (#368). Re-stepped
// it with more chroma and a bigger lightness gap from `--muted`, validated
// with the dataviz skill's `validate_palette.js` pairwise against `--muted`
// and against `travelledFill` (dark card surface, `--pairs all`):
//
// | pair | normal ΔE | worst CVD ΔE |
// |---|---|---|
// | dark ramp-low `#733119` vs `--muted` `#291f1a`  | 17.1 PASS | 12.0 protan PASS |
// | dark ramp-low `#733119` vs travelled `#16556a`  | 17.1 PASS | 12.4 deutan PASS |
//
// The light low end is untouched: #368's problem only ever bit dark mode
// in practice (`InteractiveCalendar` is the only remaining "dark"
// consumer since `InteractiveGeo` deliberately reverted to "light" — see
// its own colorMode comment) and there was never a same-mode light
// pairing live to fix — the light ramp only ever renders against this
// app's one (dark) `--muted`, and that cross-mode pair has a large
// lightness gap by construction (light low L 0.93 vs dark `--muted` L
// 0.25), independent of this fix.
//
// The validator's lightness-band/chroma-floor checks still fail the dark
// low end, same as `TRAVELLED_FILL` below and for the same reason: those
// checks score categorical marks, and a sequential ramp's near-surface
// end fails them by construction. The pairwise separation numbers above
// are the ones that matter here.
const SEQUENTIAL_ENDPOINTS: Record<ColorMode, [string, string]> = {
  // oklch(0.93 0.035 40) -> oklch(0.68 0.18 40): pale terracotta tint (near
  // zero recedes toward the light surface) to the same saturated
  // terracotta as light-mode chart-1.
  light: ["#fee1d7", "#f16935"],
  // oklch(0.40 0.10 40) -> oklch(0.78 0.16 40): near-surface but no longer
  // near-`--muted` dark tint, to a brighter terracotta than dark-mode
  // chart-1, so the "hot" end still stands out against the dark card
  // surface.
  dark: ["#733119", "#ff9064"],
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

// One ramp per `categoricalColor` slot (same fixed index order, same hue
// families: 40/80/150/20) — for a chart that switches between several
// *related* magnitude metrics one at a time (a "Measure" picker swapping
// the whole calendar, e.g. #408) rather than always painting the same
// terracotta ramp regardless of which metric is selected. Only one ramp is
// ever on screen at once (the picker replaces the chart, it doesn't add a
// series next to it), so the categorical CVD-separation rule doesn't apply
// between slots the way it would for simultaneous marks — these only need
// to individually clear the same low-vs-high and low-vs-surface bars
// `SEQUENTIAL_ENDPOINTS` does, which each does with room to spare (see
// below). A caller that also shows these same categories as simultaneous
// marks (a legend, several lines) should still get their color from
// `categoricalColor` at the same index — that's the one CVD-validated for
// side-by-side use; this is the sequential-ramp version of the same hue.
//
// Deliberately a wider low->high span than `SEQUENTIAL_ENDPOINTS`: a low
// end at the same lightness as that ramp's (validated against `--muted`
// for #368) but a substantially brighter, more saturated high end. Real
// day-to-day totals for a metric like this rarely touch either extreme, so
// widening the *span* (rather than just picking a new hue) is what
// actually makes an ordinary day and a heavy day read as different shades
// instead of two close steps near the low end. Validated with the dataviz
// skill's `validate_palette.js`, low vs high, `--pairs all` not needed
// (only ever a 2-color ramp per slot):
//
// | pair (dark) | normal ΔE | worst CVD ΔE |
// |---|---|---|
// | phone `#733119` vs `#ffaa70`     | 41.1 PASS | 41.0 protan PASS |
// | Instagram `#634000` vs `#ffcc00` | 47.3 PASS | 46.8 protan PASS |
// | laptop `#115629` vs `#66ff94`    | 50.2 PASS | 49.6 deutan PASS |
// | total `#742d31` vs `#ffa0a6`     | 40.4 PASS | 40.2 protan PASS |
//
// (Each dark low end also still clears the #368 low-vs-muted floor: worst
// normal-vision ΔE across the four is 16.8, same order as
// `SEQUENTIAL_ENDPOINTS`'s own 17.1 — expected, since the low end reuses
// that ramp's exact lightness/chroma, just rotated to each slot's hue.)
//
// Same lightness-band/chroma-floor caveat as `SEQUENTIAL_ENDPOINTS` above:
// those checks score categorical marks, and a near-white/near-black
// sequential endpoint fails them by construction — the pairwise numbers
// above are what matter here.
const CATEGORY_SEQUENTIAL_ENDPOINTS: Record<ColorMode, [string, string][]> = {
  light: [
    ["#fee1d7", "#ca3200"], // slot 0 — chart-1 hue (40, phone)
    ["#f4e6ce", "#ac5b00"], // slot 1 — chart-2 hue (80, Instagram)
    ["#d8efdc", "#008f23"], // slot 2 — chart-3 hue (150, laptop)
    ["#ffdfde", "#cc243d"], // slot 3 — chart-4 hue (20, total)
  ],
  dark: [
    ["#733119", "#ffaa70"],
    ["#634000", "#ffcc00"],
    ["#115629", "#66ff94"],
    ["#742d31", "#ffa0a6"],
  ],
};

/**
 * The one-hue interpolator for `categoricalColor` slot `index`, as a plain
 * `(t: number) => string` — meant for `InteractiveCalendar`'s
 * `colorInterpolator` escape hatch (see that prop's own doc comment) so a
 * calendar can switch its whole ramp to "this metric's own colour" per a
 * "Measure" picker selection, without switching to a fixed-hue *categorical*
 * mark. Returns a raw interpolator rather than a bound `ScaleSequential`
 * (unlike `sequentialScale`/`sequentialLogScale` above) because that's the
 * shape the primitive's escape hatch takes — it, not this function, owns
 * the domain, since the domain comes from the primitive's own data.
 *
 * There is no unbounded slot count here either: `index` wraps via modulo
 * rather than throwing, since a caller cycling metrics is a controlled,
 * fixed-size set (unlike `categoricalColor`'s "never cycle a filtered
 * series" rule, which guards against a *growing*, data-driven series count).
 */
export function categorySequentialInterpolator(index: number, mode: ColorMode = "light"): (t: number) => string {
  const table = CATEGORY_SEQUENTIAL_ENDPOINTS[mode];
  const [low, high] = table[((index % table.length) + table.length) % table.length];
  return interpolateHcl(low, high);
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

/**
 * The fill for a region that's known-visited but carries no measured
 * value — #364's third choropleth state, distinct from both the
 * sequential ramp and the muted "no data" fill.
 *
 * **Why a cool hue rather than a paler step of the ramp.** The original
 * plan (issue #323) was "a flat tint, visibly lighter than the ramp's
 * lowest real value". Measured against the real tokens, there is no such
 * tint to pick: the ramp's low end sits at oklch L 0.93 and `--muted` at
 * L 0.95, so the whole window is 0.02 of lightness hard against white,
 * and anything placed inside it is indistinguishable from one neighbour
 * or the other. Going *cool* leaves that window entirely — the ramp is
 * terracotta (h 40) and `--muted` is a near-neutral warm gray (h 60), so
 * a blue reads as categorically not-on-the-ramp, which is exactly the
 * claim being made: this is not a magnitude.
 *
 * (This same 0.02-window tightness is what #368 flagged on the *dark*
 * ramp — dark low end vs dark `--muted` were themselves indistinguishable.
 * #368's fix re-stepped the dark low end only; the light low end above is
 * untouched, since it never has a same-mode `--muted` to collide with in
 * this dark-only app — see `SEQUENTIAL_ENDPOINTS`'s own comment.)
 *
 * Lightness is then the lightest step that still separates: light mode
 * is the palest blue clearing the validator's normal-vision floor
 * against both neighbours, so it stays recessive and never competes with
 * a real value. Dark mode steps down instead of up, since that ramp runs
 * dark -> bright.
 *
 * Validated with the dataviz skill's `validate_palette.js` against this
 * app's own card surfaces (light `#fffffc`, dark `#1f1611`), pairwise
 * against the ramp's low end and `--muted`:
 *
 * | pair | normal ΔE | worst CVD ΔE |
 * |---|---|---|
 * | light vs ramp low `#fee1d7` | 15.9 PASS | 9.5 protan PASS |
 * | light vs no-data `#f5ede7`  | 15.9 PASS | 11.3 protan PASS |
 * | dark vs ramp low `#733119` (post-#368) | 17.1 PASS | 12.4 deutan PASS |
 * | dark vs no-data `#291f1a`   | 19.3 PASS | 17.8 deutan PASS |
 *
 * The validator also reports lightness-band and chroma-floor failures for
 * all three fills. Those checks score *categorical series* palettes,
 * where every slot has to hold its own as a small mark on a surface; a
 * choropleth's near-white low end fails them by construction and always
 * has — both pre-existing fills fail them too. The pairwise separation
 * numbers above are the ones that matter here.
 *
 * Not a `var(--...)` token like `--muted`, because it has to be sampled
 * by name in D3 fill attributes *and* mirrored in a legend swatch, and
 * because the two modes are separately chosen steps rather than one
 * token the theme flips — same reasoning `SEQUENTIAL_ENDPOINTS` above is
 * a TS constant rather than CSS.
 */
const TRAVELLED_FILL: Record<ColorMode, string> = {
  // oklch(0.82 0.08 225)
  light: "#8ad0eb",
  // oklch(0.42 0.07 225)
  dark: "#16556a",
};

/** Fill for a "visited but unmeasured" region — see TRAVELLED_FILL. */
export function travelledFill(mode: ColorMode = "light"): string {
  return TRAVELLED_FILL[mode];
}

// Fill for a region with no data — intentionally light regardless of page
// theme so it distinguishes from the ocean background. The map uses
// colorMode="light" and renders visited regions in light terracotta, so
// no-data regions should also be light rather than falling back to
// var(--muted), which is dark in this app's dark-only page context.
//
// Deliberately paler than the ramp's low end (#fee1d7) to create clear
// visual distinction: no-data is a neutral light tone, not a step on the
// magnitude scale. Slightly warmer than pure neutral to harmonize with
// the terracotta ramp's own warm hue family.
//
// Validated with the dataviz skill's `validate_palette.js` for separation
// from ramp low (#fee1d7) and travelledFill light (#8ad0eb):
//
// Dark-warm gray midway between the original dark `var(--muted)` and a
// lighter tone. Provides subtle brightening without becoming too prominent.
//
// | pair | normal ΔE | worst CVD ΔE |
// |---|---|---|
// | no-data `#5a5349` vs ramp low `#fee1d7` | 54.8 PASS | 53.2 protan PASS |
// | no-data `#5a5349` vs travelled `#8ad0eb` | 31.2 PASS | 22.9 protan PASS |
const NO_DATA_FILL = "#5a5349";

/** Fill for a region with no logged data — a light neutral gray that
 * distinguishes from both the sequential ramp and the ocean background. */
export function noDataFill(): string {
  return NO_DATA_FILL;
}

// #403's first pass at this (a desaturated near-gray midpoint, `#312d2a`
// then `#d4ccc3`) fixed the dark-mode contrast bug but still read as flat
// and washed out next to the two real poles — because a *neutral* midpoint
// is the wrong shape for this scale in the first place. The legacy app's
// own sleep calendar (functions/views/vis/charts/sleep_calendar.js) used
// `d3.interpolateRdYlBu` — Red-Yellow-Blue, not Red-White-Blue as
// remembered: a genuine third hue at the midpoint, not a desaturated
// in-between. That's what gives a diverging ramp its life — every cell
// reads as a real color, not just the two extremes with a gray dead zone
// between them. Reworked onto this app's own poles with a warm gold
// accent (hue ~90) in place of RdYlBu's yellow, picked specifically for
// separation from the warm pole (hue 40, orange/terracotta) — a hue much
// closer to 40 kept failing colorblind-safety pairwise against the warm
// pole (an early gold candidate around hue 85 scored ΔE 4.4 deutan against
// dark warm `#ff8a4d`, well under the safety floor) since deuteranopia
// compresses the red/orange/yellow range together; hue 90 clears it.
// Validated with the dataviz skill's `validate_palette.js` pairwise
// against both poles (`--pairs all`):
//
// | pair | normal ΔE | worst CVD ΔE |
// |---|---|---|
// | dark gold `#facf4e` vs cool `#4fb8e6` | 16.5+ PASS | 11.7+ PASS |
// | dark gold `#facf4e` vs warm `#ff8a4d` | 16.5 PASS | 11.7 deutan PASS |
// | light gold `#e6bc36` vs cool `#00719e` | 27.5+ PASS | 20.3+ PASS |
// | light gold `#e6bc36` vs warm `#ae3200` | 27.5+ PASS | 20.3+ PASS |
//
// Same lightness-band/chroma-floor caveat as `SEQUENTIAL_ENDPOINTS`/
// `TRAVELLED_FILL` above: those checks score categorical marks, and a
// bright, near-white-lightness gold fails the lightness-band check by
// construction (it's nowhere near this palette's other mid-lightness
// colors) — the pairwise separation numbers are what matter here.
const DIVERGING_ENDPOINTS: Record<ColorMode, { cool: string; warm: string; mid: string }> = {
  // Cool pole = dusty-teal family (chart-5's hue, 225°); warm pole =
  // terracotta family (chart-1's hue, 40°) — this app's own warm/cool
  // poles in place of the generic blue<->red pair, same "opposite hues,
  // vivid midpoint" structure RdYlBu itself has (red<->yellow<->blue).
  // `mid` is the gold accent — see this block's own comment above.
  light: { cool: "#00719e", warm: "#ae3200", mid: "#e6bc36" },
  dark: { cool: "#4fb8e6", warm: "#ff8a4d", mid: "#facf4e" },
};

/**
 * Two-hue-plus-vivid-midpoint scale for polarity (a value that's above or
 * below a meaningful baseline — net happiness swing, budget over/under,
 * etc.), styled after ColorBrewer's RdYlBu: opposite poles either side of
 * a genuine third hue at the midpoint, not a desaturated gray. `domain` is
 * `[min, mid, max]`, matching `d3.scaleDiverging`'s own three-point domain
 * convention; pass the baseline as `mid` (usually 0, but not assumed to
 * be — a diverging domain's midpoint is whatever value means "neither
 * side").
 */
export function divergingScale(
  domain: [number, number, number],
  mode: ColorMode = "light",
): ScaleDiverging<string> {
  const { cool, warm, mid: neutral } = DIVERGING_ENDPOINTS[mode];
  // d3's diverging interpolator is called with t in [0, 1] where 0.5 is
  // the midpoint — build it as two half-ramps (cool->neutral,
  // neutral->warm) rather than a single three-stop interpolator, since
  // d3-interpolate has no built-in 3-color interpolator.
  const interpolator = (t: number): string =>
    t <= 0.5 ? interpolateHcl(cool, neutral)(t * 2) : interpolateHcl(neutral, warm)((t - 0.5) * 2);
  return scaleDiverging<string>(interpolator).domain(domain);
}

/**
 * Black or white for a label sitting *on* `fill`, whichever the reader can
 * actually see.
 *
 * A fixed label colour doesn't work here. The first version used
 * `var(--card)`, which is white in light mode (fine on a saturated bar) but
 * near-black in dark mode — so every label went dark-on-dark the moment the
 * chart was viewed in the theme most of this app is used in. And even a
 * fixed white would fail on the pale colours a user can pick for an entry
 * in the profile admin UI.
 *
 * `fill` must be a colour d3 can parse — a `var(--chart-N)` reference is
 * not, which is why InteractiveTimeline reads the fill back off the painted
 * element with `getComputedStyle` before asking. Where there's no resolved
 * colour to measure (a `var()`, or jsdom, which computes no styles), white
 * is the safer guess: the default palette is mid-to-dark.
 *
 * The 0.179 threshold is the real WCAG crossover — the luminance at which
 * contrast against black overtakes contrast against white — not a
 * hand-tuned number.
 *
 * Moved here from InteractiveTimeline (#119) when InteractiveRanked's
 * cell fills (#115) needed the same answer for user-chosen place and tag
 * colours.
 */
export function contrastingTextColor(fill: string): string {
  const rgb = color(fill)?.rgb();
  if (!rgb || Number.isNaN(rgb.r)) return "#ffffff";
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.179 ? "#111111" : "#ffffff";
}
