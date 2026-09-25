// Small descriptive statistics for comparing groups (#444's Work vs.
// Happiness, and any later "average X by Y" chart). Pure, no d3 — the same
// boundary as bin.ts: summarizing rows a page already fetched.

export type GroupSummary = {
  n: number;
  mean: number;
  /** Sample standard deviation (n − 1); 0 for a single value. */
  sd: number;
  /** 95% confidence interval for the mean. Collapses to the mean itself at
   * n = 1 — one day says nothing about spread, and drawing *no* interval
   * would read as "certain" rather than "unknown", so callers should show
   * `n` alongside. */
  ciLow: number;
  ciHigh: number;
};

// Two-sided 95% Student's t critical values for df = 1..30. Beyond 30 the
// normal 1.96 is within 2% of the true value. A table rather than an
// inverse-t implementation: this is the only quantile the app needs, and
// thirty numbers are easier to check than a numerical approximation.
const T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCritical95(df: number): number {
  if (df < 1) return Infinity;
  return T_95[df - 1] ?? 1.96;
}

/**
 * Mean with a t-based 95% interval.
 *
 * t rather than the normal 1.96 because the groups this is for are often
 * small — a band of hours with eight days in it — and the normal
 * approximation understates how uncertain a small group's mean is, making
 * a thin row look as trustworthy as a full one.
 */
export function summarize(values: number[]): GroupSummary | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { n, mean, sd: 0, ciLow: mean, ciHigh: mean };
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const half = tCritical95(n - 1) * (sd / Math.sqrt(n));
  return { n, mean, sd, ciLow: mean - half, ciHigh: mean + half };
}
