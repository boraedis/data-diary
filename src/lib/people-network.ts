// The people network's graph-building logic, kept pure (no DB, no DOM) the
// same way life-timeline.ts and viz/timeline.ts sit apart from the
// components that draw them. The page ships every day's list of logged
// people to the client once; everything here re-runs in the browser when
// the period, the mention floor, or the strictness changes, so those
// controls respond instantly instead of round-tripping to the server.
//
// ## Why not raw shared-day counts
//
// The first rebuild drew an edge for any pair logged together on 2+ days
// and sized it by that count. On this diary's data that's ~3,000 edges
// among the 242 people with 10+ mentions — a solid hairball — and the
// thickest edges are just the most-logged people with each other: two
// people who each appear on 800 days will share a couple of hundred by
// sheer volume, whether or not they're actually a pair. Raw counts measure
// how often you see both people, not whether you see them *together*.
//
// Legacy's own formula, `(√(c/a) + √(c/b))²` with a `c > 5 && ≥ 0.8`
// cutoff, was already reaching for the right idea (normalise by each
// person's own volume); it's a close cousin of the Ochiai coefficient
// below, just with a hand-picked threshold.
//
// ## What this does instead
//
// Two separate questions, two separate numbers:
//
// 1. **Is there a real tie?** (does an edge exist at all) — a one-sided
//    hypergeometric test per pair: given N logged days, person A on a of
//    them and B on b, how likely is it to see them together on c or more
//    days if the two were logged independently? That's the "statistically
//    validated network" construction (Tumminello et al., 2011, PLoS ONE)
//    for projecting a bipartite day×person record onto a person×person
//    graph. With ~29,000 candidate pairs, some would pass p < 0.01 by luck
//    alone, so the cutoff is corrected for multiple comparisons — Benjamini-
//    Hochberg false-discovery rate by default, Bonferroni for "strong".
//
// 2. **How strong is it?** (edge thickness, and how hard the layout pulls
//    two people together) — the Ochiai / cosine coefficient c / √(a·b):
//    the geometric mean of "share of A's days that include B" and "share
//    of B's days that include A". 1 means they only ever appear together,
//    and it's comparable between a pair seen 20 times and a pair seen 800
//    times, which a raw count never is.
//
// Keeping them apart matters: significance grows with sample size (two
// heavily-logged people with a modest overlap are *very* significantly
// linked) while Ochiai doesn't, so significance alone would still paint
// the busiest people as the strongest pairs.
//
// Known limitation, left alone deliberately: the null model treats every
// logged day in the window as equally likely for everyone, so two people
// from the same era (college, one job) co-occur "more than chance" partly
// because they were both *around* then. That's arguably still the answer
// you want from a friend-graph — and the period control is the tool for
// looking inside one era — but it's why a narrowed period can drop edges
// that show up over the whole history.

import { toDateString } from "@/lib/date";

export type PeopleNetworkDay = {
  /** "YYYY-MM-DD". */
  date: string;
  /** Distinct person ids logged that day, across every person slot. */
  people: number[];
};

export type PeopleNetworkPerson = {
  id: number;
  name: string;
  tagId: number | null;
  tagName: string | null;
  /** The tag's own hex colour, or null when untagged / uncoloured. */
  color: string | null;
};

export type PeopleNetworkInput = { days: PeopleNetworkDay[]; people: PeopleNetworkPerson[] };

export type NetworkStrictness = "strong" | "significant" | "loose";

export const STRICTNESS_OPTIONS: { id: NetworkStrictness; label: string }[] = [
  { id: "strong", label: "Strong" },
  { id: "significant", label: "Significant" },
  { id: "loose", label: "Loose" },
];

/** The multiple-comparison correction and error rate behind each
 * strictness level. "significant" is the default: a 1% false-discovery
 * rate, i.e. of the edges drawn, roughly 1 in 100 is expected to be a
 * coincidence. "strong" is family-wise (Bonferroni) — the chance of even
 * one coincidental edge anywhere in the graph is under 1% — and reads as
 * "only the unmistakable ties". "loose" relaxes the FDR to 5%. */
const STRICTNESS_RULES: Record<NetworkStrictness, { method: "bonferroni" | "bh"; alpha: number }> = {
  strong: { method: "bonferroni", alpha: 0.01 },
  significant: { method: "bh", alpha: 0.01 },
  loose: { method: "bh", alpha: 0.05 },
};

export const MIN_MENTION_OPTIONS = [5, 10, 25, 50] as const;
export type MinMentions = (typeof MIN_MENTION_OPTIONS)[number];

/** A floor on shared days, independent of the significance test. Two
 * rarely-logged people seen together twice can clear a p-value on paper
 * (their expected overlap is ~0.03 days), but "twice" isn't a relationship
 * worth a line on the chart, and it's the cheapest way to keep a loose
 * setting from filling with one-off pairs. */
export const MIN_SHARED_DAYS = 3;

export type BuiltNode = {
  id: number;
  name: string;
  /** Days logged within the period. */
  count: number;
  tagId: number | null;
  tagName: string | null;
  color: string | null;
  /** First and last logged day within the period. */
  first: string;
  last: string;
};

export type BuiltEdge = {
  source: number;
  target: number;
  /** Days both people were logged. */
  shared: number;
  /** Ochiai coefficient, 0–1 — see the file header. */
  overlap: number;
  /** One-sided hypergeometric p-value, uncorrected. */
  p: number;
};

export type BuiltNetwork = {
  nodes: BuiltNode[];
  edges: BuiltEdge[];
  /** Days with at least one person logged, within the period — the N the
   * significance test is run against. */
  dayCount: number;
};

export type BuildOptions = {
  minMentions: number;
  strictness: NetworkStrictness;
  /** Inclusive; null for the whole history. */
  range: [Date, Date] | null;
};

// --- Statistics ------------------------------------------------------------

/** ln(k!) for k = 0..n, built once per call — the tail sums below evaluate
 * hundreds of binomial coefficients per pair, and a lookup table keeps that
 * to additions. */
function logFactorials(n: number): Float64Array {
  const table = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) table[i] = table[i - 1] + Math.log(i);
  return table;
}

/**
 * P(X ≥ k) for X ~ Hypergeometric(population N, successes a, draws b) —
 * the probability of two independently-logged people with a and b days
 * sharing k or more of N. Summed directly in log space from k upward,
 * stopping once terms stop contributing: for any k above the expected
 * overlap (which is every pair that matters here) the terms fall away
 * geometrically, so this touches a handful of terms rather than all
 * min(a, b) - k of them.
 */
export function hypergeometricUpperTail(
  N: number,
  a: number,
  b: number,
  k: number,
  lf: Float64Array = logFactorials(N),
): number {
  const hi = Math.min(a, b);
  const lo = Math.max(0, a + b - N);
  if (k <= lo) return 1;
  if (k > hi) return 0;
  const logChoose = (n: number, r: number) => lf[n] - lf[r] - lf[n - r];
  const logDenominator = logChoose(N, b);
  let sum = 0;
  for (let x = k; x <= hi; x++) {
    const term = Math.exp(logChoose(a, x) + logChoose(N - a, b - x) - logDenominator);
    sum += term;
    // Past the mode the terms only shrink; once one is negligible next to
    // the running sum, the rest are too.
    if (term < sum * 1e-15 && x > (a * b) / N) break;
  }
  return Math.min(1, sum);
}

/**
 * The p-value cutoff an edge must clear, given every candidate's p-value
 * and the number of hypotheses tested.
 *
 * `testedCount` is every *possible* pair among the included people, not
 * just the ones that ever co-occurred: a pair that never shared a day was
 * still implicitly tested (and failed), and leaving it out of the count
 * would make the correction look less strict than it is.
 */
export function significanceCutoff(
  pValues: number[],
  testedCount: number,
  method: "bonferroni" | "bh",
  alpha: number,
): number {
  if (testedCount === 0) return 0;
  if (method === "bonferroni") return alpha / testedCount;
  // Benjamini–Hochberg: the largest p(i) with p(i) ≤ (i / m)·α; everything
  // at or below it passes.
  const sorted = [...pValues].sort((x, y) => x - y);
  let cutoff = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] <= ((i + 1) / testedCount) * alpha) cutoff = sorted[i];
  }
  return cutoff;
}

// --- Graph -----------------------------------------------------------------

export function buildPeopleNetwork(input: PeopleNetworkInput, options: BuildOptions): BuiltNetwork {
  const { minMentions, strictness, range } = options;
  const start = range ? toDateString(range[0]) : null;
  const end = range ? toDateString(range[1]) : null;
  const days = input.days.filter(
    (d) => d.people.length > 0 && (start === null || d.date >= start) && (end === null || d.date <= end),
  );

  const counts = new Map<number, { count: number; first: string; last: string }>();
  for (const day of days) {
    for (const id of day.people) {
      const cur = counts.get(id);
      if (cur) {
        cur.count += 1;
        // Days arrive oldest-first from the server, but don't lean on it.
        if (day.date < cur.first) cur.first = day.date;
        if (day.date > cur.last) cur.last = day.date;
      } else {
        counts.set(id, { count: 1, first: day.date, last: day.date });
      }
    }
  }

  const personById = new Map(input.people.map((p) => [p.id, p]));
  const included = new Set<number>();
  const nodes: BuiltNode[] = [];
  for (const [id, stat] of counts) {
    if (stat.count < minMentions) continue;
    const person = personById.get(id);
    if (!person) continue;
    included.add(id);
    nodes.push({
      id,
      name: person.name,
      count: stat.count,
      tagId: person.tagId,
      tagName: person.tagName,
      color: person.color,
      first: stat.first,
      last: stat.last,
    });
  }
  // Biggest first, so the SVG paints small nodes on top of large ones and
  // a small node sitting over a hub stays hoverable.
  nodes.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));

  const shared = new Map<string, number>();
  for (const day of days) {
    const ids = day.people.filter((id) => included.has(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}-${ids[j]}` : `${ids[j]}-${ids[i]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  const N = days.length;
  const lf = logFactorials(N);
  const candidates: BuiltEdge[] = [];
  for (const [key, c] of shared) {
    if (c < MIN_SHARED_DAYS) continue;
    const [source, target] = key.split("-").map(Number);
    const a = counts.get(source)!.count;
    const b = counts.get(target)!.count;
    candidates.push({
      source,
      target,
      shared: c,
      overlap: c / Math.sqrt(a * b),
      p: hypergeometricUpperTail(N, a, b, c, lf),
    });
  }

  const rule = STRICTNESS_RULES[strictness];
  const tested = (included.size * (included.size - 1)) / 2;
  const cutoff = significanceCutoff(
    candidates.map((e) => e.p),
    tested,
    rule.method,
    rule.alpha,
  );
  const edges = candidates.filter((e) => e.p <= cutoff);

  return { nodes, edges, dayCount: N };
}
