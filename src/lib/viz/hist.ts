import * as d3 from "d3";

// Pure binning for InteractiveHist's multi-series mode — the same split
// `timeline.ts` has from InteractiveTimeline, so the bucketing rules are
// unit-testable without rendering an SVG.
//
// The one rule that matters: every series is counted against the *same*
// bucket edges. Binning each series on its own with d3.bin's auto
// thresholds would give each a different set of edges (Sturges picks a
// count from the series' own size and extent), and two overlaid or stacked
// histograms whose bars don't share edges can't be compared at all. So the
// edges come from binning every value together once, and each series is
// then tallied into those edges.

type Bin = d3.Bin<number, number> & { x0: number; x1: number };

export type HistSeriesValues = { id: string; values: readonly number[] };

/** One bucket, `[x0, x1)` — the last bucket also includes its own `x1`,
 * matching d3.bin — with each series' count in it, keyed by series id. A
 * series with nothing in the bucket still has an explicit 0. */
export type HistBucket = { x0: number; x1: number; counts: Record<string, number> };

export type BinnedSeries = {
  buckets: HistBucket[];
  /** Values that landed in *some* bucket, per series — the denominator for a
   * share-of-series reading. Values outside an explicit `domain` are
   * excluded here too, so shares always sum to 100% of what's drawn. */
  totals: Record<string, number>;
};

export function binSeries(
  series: readonly HistSeriesValues[],
  { domain, thresholds }: { domain?: [number, number]; thresholds?: number[] } = {},
): BinnedSeries {
  let binGen = d3.bin();
  if (domain) binGen = binGen.domain(domain);
  if (thresholds) binGen = binGen.thresholds(thresholds);
  const allValues = series.flatMap((s) => s.values);
  // Zero-width bins are dropped: thresholds that include the domain's own
  // top edge (`d3.range(lo, hi + 1)`, the natural way to write "one bucket
  // per point") make d3.bin emit a final [hi, hi] bin, which draws as
  // nothing — so the days logged at exactly `hi` would vanish. Without it,
  // they land in the last real bucket, which includes its upper edge.
  const combined = binGen(allValues).filter(
    (b): b is Bin => b.x0 !== undefined && b.x1 !== undefined && b.x1 > b.x0,
  );

  const edges = combined.length > 0 ? [...combined.map((b) => b.x0), combined[combined.length - 1].x1] : [];
  const buckets: HistBucket[] = combined.map((b) => ({
    x0: b.x0,
    x1: b.x1,
    counts: Object.fromEntries(series.map((s) => [s.id, 0])),
  }));
  const totals: Record<string, number> = Object.fromEntries(series.map((s) => [s.id, 0]));
  if (buckets.length === 0) return { buckets, totals };

  const lo = edges[0];
  const hi = edges[edges.length - 1];
  for (const s of series) {
    for (const v of s.values) {
      if (!(v >= lo && v <= hi)) continue; // also drops NaN
      // bisectRight - 1 is the bucket whose x0 <= v; clamp so v === hi
      // lands in the last bucket rather than one past it.
      const i = Math.min(d3.bisectRight(edges, v) - 1, buckets.length - 1);
      buckets[i].counts[s.id] += 1;
      totals[s.id] += 1;
    }
  }
  return { buckets, totals };
}
