/**
 * In-band label placement for a stacked area (#456): the pure geometry
 * behind `InteractiveArea`'s labels, split out the same way `timeline.ts`
 * is from `InteractiveTimeline` and `hierarchy.ts` from `InteractiveDonut`.
 *
 * The labels *are* the legend, as they were in legacy (`AreaV2` →
 * `labelProperties` in `vis_functions.js`), so each one is sized to fill
 * its band: the largest text that fits, not a fixed 11px dropped at the
 * widest point. The search is legacy's own. For every start position,
 * extend the span rightward. The tallest text that fits the span is capped
 * by the band's thinnest stretch inside it (floor − ceiling) and by the
 * span's width divided by the label's width-per-pixel-of-font. Keep the
 * best box over every start.
 *
 * Everything here is in SVG pixels (y grows downward, so a band's `bottom`
 * is the larger number). The caller supplies the band's edges at its data
 * points. This module fills in extra samples so a box's edges can land
 * between points on a sparse series (ten yearly buckets would otherwise
 * give ten possible box edges).
 *
 * The edges are interpolated linearly between points, while the painted
 * band uses `curveMonotoneX`. On any series dense enough for a label to
 * matter the two agree to within a pixel. The vertical padding below
 * covers the rest rather than modelling the cubic.
 */

export type BandProfile = {
  /** Pixel x of each data point, ascending. */
  xs: readonly number[];
  /** Pixel y of the band's lower edge at each point. */
  bottoms: readonly number[];
  /** Pixel y of the band's upper edge at each point (≤ the matching bottom). */
  tops: readonly number[];
};

export type LabelFitOptions = {
  /** Text below this size isn't drawn at all. */
  minFont: number;
  /** Past this size, the drawn size grows with the square root of the
   * room available rather than linearly (see `capFontSize`). */
  capFont: number;
  /** Minimum number of sample positions across the band. Every data point
   * is always a sample; this only adds more when points are sparse. */
  minSamples?: number;
  /** Clear space kept left and right of the text, px. */
  padX?: number;
  /** Clear space kept above and below the text, px. */
  padY?: number;
};

export type LabelBox = {
  /** Centre of the box the label fits, px. */
  x: number;
  y: number;
  /** The largest font size that fits, before the cap. */
  fitSize: number;
  /** The size to actually draw: `fitSize` after `capFontSize`. */
  fontSize: number;
};

const DEFAULT_MIN_SAMPLES = 100;
const DEFAULT_PAD_X = 4;
const DEFAULT_PAD_Y = 2;

/**
 * Linear growth up to `cap`, then `cap · √(size / cap)`: continuous at the
 * cap, and half as steep there, so a band four times the cap gets a label
 * twice the cap rather than a billboard. The cap wasn't found in legacy's
 * `AreaV2` (see #456); this curve is the "square-root growth" the issue
 * describes.
 */
export function capFontSize(size: number, cap: number): number {
  return size <= cap ? size : cap * Math.sqrt(size / cap);
}

/**
 * Resamples a band onto every data point plus evenly spaced fill-ins, so
 * the search below has at least `minSamples` candidate box edges.
 */
function resample(profile: BandProfile, minSamples: number): BandProfile {
  const { xs, bottoms, tops } = profile;
  const n = xs.length;
  if (n < 2 || n >= minSamples) return profile;
  const x0 = xs[0];
  const x1 = xs[n - 1];
  const step = (x1 - x0) / (minSamples - 1);
  const out: { xs: number[]; bottoms: number[]; tops: number[] } = { xs: [], bottoms: [], tops: [] };
  let k = 0;
  const push = (x: number) => {
    while (k < n - 2 && xs[k + 1] < x) k++;
    const span = xs[k + 1] - xs[k];
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, (x - xs[k]) / span));
    out.xs.push(x);
    out.bottoms.push(bottoms[k] + (bottoms[k + 1] - bottoms[k]) * t);
    out.tops.push(tops[k] + (tops[k + 1] - tops[k]) * t);
  };
  // Merge the evenly spaced grid with the real points, so no pinch at a
  // real point falls between two grid samples and goes unseen.
  let p = 0;
  for (let s = 0; s < minSamples; s++) {
    const gx = x0 + step * s;
    while (p < n && xs[p] <= gx) {
      push(xs[p]);
      p++;
    }
    if (out.xs[out.xs.length - 1] !== gx) push(gx);
  }
  while (p < n) push(xs[p++]);
  return out;
}

/**
 * The largest box on this band that fits a label whose rendered width is
 * `widthRatio × fontSize`, or null when nothing reaches `minFont`.
 *
 * `widthRatio` is measured by the caller (from the real rendered text, at
 * a reference size) rather than estimated from character classes the way
 * legacy's `textWidthRatio` did, because the browser can simply say.
 */
export function fitBandLabel(profile: BandProfile, widthRatio: number, options: LabelFitOptions): LabelBox | null {
  const { minFont, capFont, minSamples = DEFAULT_MIN_SAMPLES, padX = DEFAULT_PAD_X, padY = DEFAULT_PAD_Y } = options;
  if (profile.xs.length < 2 || !(widthRatio > 0)) return null;
  const { xs, bottoms, tops } = resample(profile, minSamples);
  const n = xs.length;

  let best: { i: number; j: number; floor: number; ceil: number; size: number } | null = null;
  for (let i = 0; i < n; i++) {
    const threshold = best ? best.size : minFont;
    // A span can only get thinner as it widens, so a start whose own
    // thickness can't beat the current best can't lead anywhere.
    if (bottoms[i] - tops[i] - 2 * padY < threshold) continue;
    let floor = bottoms[i];
    let ceil = tops[i];
    for (let j = i + 1; j < n; j++) {
      floor = Math.min(floor, bottoms[j]);
      ceil = Math.max(ceil, tops[j]);
      const room = floor - ceil - 2 * padY;
      const bar = best ? best.size : minFont;
      if (room < bar) break;
      const size = Math.min(room, (xs[j] - xs[i] - 2 * padX) / widthRatio);
      // Strictly greater: once width stops being the limit the size stays
      // at `room`, and the first (narrowest) span that reached it is the
      // tight box to centre in.
      if (size >= minFont && (!best || size > best.size)) best = { i, j, floor, ceil, size };
    }
  }
  if (!best) return null;
  return {
    x: (xs[best.i] + xs[best.j]) / 2,
    y: (best.floor + best.ceil) / 2,
    fitSize: best.size,
    fontSize: capFontSize(best.size, capFont),
  };
}

/**
 * Legacy's alias fallback: when the full name only fits small (under
 * `5 × minFont`) and the category has a shorter alias, try the alias, and
 * use it if the full name doesn't fit at all or the alias fits at least
 * 1.5× larger. Otherwise the full name wins, even at a smaller size.
 */
export const ALIAS_TRY_BELOW = 5;
export const ALIAS_MIN_GAIN = 1.5;

export function fitBandLabelWithAlias(
  profile: BandProfile,
  label: { text: string; widthRatio: number },
  alias: { text: string; widthRatio: number } | null,
  options: LabelFitOptions,
): (LabelBox & { text: string }) | null {
  const full = fitBandLabel(profile, label.widthRatio, options);
  if (alias && alias.text !== label.text && (!full || full.fitSize < ALIAS_TRY_BELOW * options.minFont)) {
    const short = fitBandLabel(profile, alias.widthRatio, options);
    if (short && (!full || short.fitSize >= ALIAS_MIN_GAIN * full.fitSize)) return { ...short, text: alias.text };
  }
  return full ? { ...full, text: label.text } : null;
}
