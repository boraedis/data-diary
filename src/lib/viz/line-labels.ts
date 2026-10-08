/**
 * On-chart label placement for `InteractiveLine` (#110): the pure geometry
 * behind its end-of-line labels and its per-point value labels, split out
 * the same way `area-labels.ts` is from `InteractiveArea` and `timeline.ts`
 * from `InteractiveTimeline`.
 *
 * Legacy's Averager drew both (`endValueLabel` and the value-label block in
 * `vis_functions.js`). Its point labels were nudged perpendicular to the
 * local line gradient with font-size-specific constants. That math isn't
 * ported. What is kept is its rule: a label only appears where it fits, and
 * one that would collide is dropped rather than squeezed in. The tiebreaker
 * throughout is #110's "clean, editorial look over density". When in doubt,
 * draw fewer labels.
 *
 * Everything here is in plot pixels (y grows downward). Text widths are
 * measured by the caller, from the real rendered text where the browser can
 * do that.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** A series' drawn path as straight segments between its points. The
 * painted line uses `curveMonotoneX`, which never overshoots its points
 * vertically, so the straight segment is a close enough stand-in for
 * collision testing at label scale. */
export type Polyline = readonly { x: number; y: number }[];

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Whether segment p→q passes through `box` (Liang–Barsky clipping). */
export function segmentIntersectsBox(p: { x: number; y: number }, q: { x: number; y: number }, box: Box): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, p.x - box.x0],
    [dx, box.x1 - p.x],
    [-dy, p.y - box.y0],
    [dy, box.y1 - p.y],
  ];
  for (const [pe, qe] of edges) {
    if (pe === 0) {
      if (qe < 0) return false;
      continue;
    }
    const t = qe / pe;
    if (pe < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function boxCrossesLine(box: Box, line: Polyline): boolean {
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1];
    const q = line[i];
    // Cheap reject before the clip test: most segments are nowhere near.
    if (Math.max(p.x, q.x) < box.x0 || Math.min(p.x, q.x) > box.x1) continue;
    if (segmentIntersectsBox(p, q, box)) return true;
  }
  return false;
}

// --- End labels -----------------------------------------------------------

/**
 * Spreads end-of-line labels vertically so none overlap, keeping each as
 * close to its line's last point as it can. Two passes over the labels
 * sorted by wanted position: down, pushing each clear of the one above, then
 * up from the bottom bound, pulling back any that ran off the bottom. If
 * they can't all fit between `min` and `max`, the last pass leaves them
 * overlapping at the top rather than dropping any, since every visible line
 * needs its name.
 *
 * Returns the placed centre y for each input, in input order.
 */
export function spreadEndLabels(
  wanted: readonly number[],
  { height, min, max }: { height: number; min: number; max: number },
): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const half = height / 2;
  const placed = order.map(({ y }) => Math.min(max - half, Math.max(min + half, y)));
  for (let k = 1; k < placed.length; k++) {
    placed[k] = Math.max(placed[k], placed[k - 1] + height);
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    const ceiling = k === placed.length - 1 ? max - half : placed[k + 1] - height;
    placed[k] = Math.min(placed[k], ceiling);
  }
  for (let k = 0; k < placed.length; k++) {
    placed[k] = Math.max(placed[k], min + half);
  }
  const out = new Array<number>(wanted.length);
  order.forEach(({ i }, k) => {
    out[i] = placed[k];
  });
  return out;
}

// --- Point labels ---------------------------------------------------------

export type PointLabelCandidate = {
  /** Echoed back on the placed label, so the caller can find its text. */
  key: string;
  /** Which series' line this point sits on. */
  seriesIndex: number;
  /** The point itself, px. */
  x: number;
  y: number;
  /** Its marker's radius, px (0 when the series draws none). */
  radius: number;
  /** The label text's measured size, px. */
  width: number;
  height: number;
  /** Higher places first. */
  priority: number;
  /** The side tried first. The other side is the fallback. */
  prefer: "above" | "below";
};

export type PlacedPointLabel = {
  key: string;
  /** Centre of the text, px. */
  x: number;
  y: number;
  side: "above" | "below";
};

/** Space between a marker's edge and its label, px. */
const POINT_LABEL_GAP = 3;

function pointLabelBox(c: PointLabelCandidate, side: "above" | "below", bounds: Box): Box | null {
  const offset = c.radius + POINT_LABEL_GAP;
  const y0 = side === "above" ? c.y - offset - c.height : c.y + offset;
  const y1 = y0 + c.height;
  // Slid sideways to stay inside the plot (a first or last point's label),
  // never vertically: a label floating off its point reads as a different
  // point's.
  let x0 = c.x - c.width / 2;
  if (x0 < bounds.x0) x0 = bounds.x0;
  if (x0 + c.width > bounds.x1) x0 = bounds.x1 - c.width;
  if (x0 < bounds.x0 || y0 < bounds.y0 || y1 > bounds.y1) return null;
  return { x0, y0, x1: x0 + c.width, y1 };
}

/**
 * Greedily places value labels, highest priority first. Each tries its
 * preferred side of its point, then the other. A placement is rejected if
 * it leaves `bounds`, overlaps a label already placed, covers any series'
 * marker, or crosses any series' line, its own included. A candidate with
 * no clean side is simply not drawn — legacy's "hidden if it'd overlap"
 * rule.
 */
export function placePointLabels(
  candidates: readonly PointLabelCandidate[],
  { bounds, lines, markers }: { bounds: Box; lines: readonly Polyline[]; markers: readonly Box[] },
): PlacedPointLabel[] {
  const placed: PlacedPointLabel[] = [];
  const taken: Box[] = [];
  const order = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of order) {
    const sides: ("above" | "below")[] = c.prefer === "above" ? ["above", "below"] : ["below", "above"];
    for (const side of sides) {
      const box = pointLabelBox(c, side, bounds);
      if (!box) continue;
      if (taken.some((t) => overlaps(box, t))) continue;
      if (markers.some((m) => overlaps(box, m))) continue;
      if (lines.some((line) => boxCrossesLine(box, line))) continue;
      taken.push(box);
      placed.push({ key: c.key, x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, side });
      break;
    }
  }
  return placed;
}

/**
 * The side a point's label should try first: above a peak, below a trough,
 * judged against the mean of its neighbours. The line leaves a peak
 * downward on both sides, so the space above it is the clear side, and vice
 * versa. An end point has one neighbour; a lone point has none and goes
 * above.
 */
export function preferredSide(ys: readonly number[], i: number): "above" | "below" {
  const neighbours = [ys[i - 1], ys[i + 1]].filter((v): v is number => v !== undefined);
  if (neighbours.length === 0) return "above";
  const mean = neighbours.reduce((s, v) => s + v, 0) / neighbours.length;
  // Pixel y: a smaller y than the neighbours is higher on screen, a peak.
  return ys[i] <= mean ? "above" : "below";
}

/**
 * Ranks a series' points for labelling: last, then highest and lowest, then
 * everything else in date order. When collisions force a choice, the
 * labels that survive are the ones an editor would keep: where the line
 * ends and its extremes.
 */
export function pointPriorities(values: readonly number[]): number[] {
  const n = values.length;
  const out = values.map((_, i) => n - i);
  if (n === 0) return out;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < n; i++) {
    if (values[i] > values[hi]) hi = i;
    if (values[i] < values[lo]) lo = i;
  }
  out[lo] = n + 1;
  out[hi] = n + 2;
  out[n - 1] = n + 3;
  return out;
}

/**
 * Whether a series' points are spread wide enough for value labels at all:
 * every gap between neighbouring points must clear the wider of the two
 * labels either side of it. This is the density gate legacy's
 * `alwaysShowValueLabels` threshold stood for. It runs before collision
 * testing, so a dense series reads as a clean line instead of a scatter of
 * whichever labels happened to survive.
 */
export function pointsSparseEnough(xs: readonly number[], widths: readonly number[], gap = 6): boolean {
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] < Math.max(widths[i - 1], widths[i]) + gap) return false;
  }
  return true;
}
