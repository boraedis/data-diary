// Tick values for `SequentialLegend`'s gradient bar (#449). Pure, so it's
// testable without rendering a legend, and so the legend component stays
// about layout.
//
// Why ticks at all: the legend used to label only its two exact end
// values ("5.3h" ... "10.7h"), which reads as precise data but gives the
// eye nothing to interpolate against partway along the ramp. Rounded
// in-range values ("6h, 8h, 10h") are what an axis would show, and they're
// what the reader actually compares a cell against.
//
// What this deliberately does NOT do is `.nice()` the domain itself. That
// would widen the labeled range past the data, and the ramp would then
// either stop short of its own end labels or paint colors no cell uses.
// Ticks are picked from *inside* the real domain, so a data extent that
// happens to fall between round numbers leaves its ends unlabeled, the
// same as any d3 axis.

import * as d3 from "d3";

export type LegendTick = {
  value: number;
  /** 0-1 position along the bar. */
  t: number;
};

/**
 * @param domain The bar's labeled `[min, max]`.
 * @param scale How positions along the bar map to values. `"linear"` is
 *   a plain fraction across `domain`; `"log"` matches a log color scale
 *   whose gradient was sampled evenly in log space (the geo choropleths).
 * @param unit Round in multiples of this rather than of the raw value.
 *   Sleep is stored in minutes but read in hours; without `unit: 60`, "nice"
 *   minute values (300, 400, 500) come out as 5h, 6.7h and 8.3h.
 * @param count Target tick count for the linear case. It's a hint, the same
 *   as d3's own `ticks(count)`.
 *
 * Returns `null` when no useful ticks fit (a degenerate or non-positive log
 * domain, or fewer than two round values inside the range). The caller
 * then falls back to labeling the exact ends, so a legend always says
 * *something*.
 */
export function legendTicks(
  domain: [number, number],
  { scale = "linear", unit = 1, count = 5 }: { scale?: "linear" | "log"; unit?: number; count?: number } = {},
): LegendTick[] | null {
  const [lo, hi] = domain;
  if (!(hi > lo)) return null;

  if (scale === "log") {
    if (lo <= 0) return null;
    const pos = d3.scaleLog().domain(domain).range([0, 1]);
    // d3's log ticks include every integer multiple of each power of ten
    // (1, 2, 3 ... 9, 10, 20 ...), which crowds a short bar. Powers of ten
    // alone read best when the range spans a few decades. A narrow range
    // (one decade or less) needs the 2x and 5x steps too, or it ends up
    // with a single tick.
    const all = pos.ticks();
    const leading = (v: number) => Math.round(v / 10 ** Math.floor(Math.log10(v) + 1e-9));
    const decades = all.filter((v) => leading(v) === 1);
    const values = decades.length >= 3 ? decades : all.filter((v) => [1, 2, 5].includes(leading(v)));
    return values.length >= 2 ? values.map((value) => ({ value, t: pos(value) })) : null;
  }

  const scaled = d3.ticks(lo / unit, hi / unit, count).map((v) => v * unit);
  // Guard against float drift pushing an end tick fractionally outside
  // the domain (e.g. 0.30000000000000004 vs a domain max of 0.3).
  const eps = (hi - lo) * 1e-9;
  const values = scaled.filter((v) => v >= lo - eps && v <= hi + eps);
  if (values.length < 2) return null;
  return values.map((value) => ({ value, t: Math.min(1, Math.max(0, (value - lo) / (hi - lo))) }));
}
