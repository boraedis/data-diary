/**
 * Auto-fit value domain with headroom, floored at zero for non-negative
 * data (#584).
 *
 * Every auto-domaining chart used to pad its extent symmetrically, so a
 * measure that can't go negative — hours of screen time, sleep, work, a
 * count, a weight — showed a strip of axis below 0 that no value could
 * ever occupy: "−1h" of screen time reads as a bug, and the wasted band
 * squashes the data above it. The rule is inferred from the values rather
 * than declared per chart: if nothing being fitted is below zero, the
 * domain never extends below zero either. That keeps it automatic for
 * every current and future chart, and a measure that genuinely goes
 * negative (a diverging delta) still gets padding on both sides because
 * its own values say so.
 *
 * This floors the domain, it doesn't pin it — a weight series still fits to
 * roughly 160–190, not 0–190. A chart that wants its baseline at zero (a
 * duration where the baseline itself is meaningful) passes InteractiveLine's
 * `yMin` instead. Callers fitting a ±spread band around a non-negative
 * value should clip the band at zero first (see `TrendExplorer`), or the
 * band's own negative tail defeats the floor.
 */
export function padDomain(values: readonly number[], fraction = 0.1): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  const pad = (hi - lo) * fraction || 1;
  return [lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad];
}
