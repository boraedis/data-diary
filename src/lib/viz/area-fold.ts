/**
 * The band cap for a stacked area (#456): past `max` categories, the
 * smallest fold into one "Other" band.
 *
 * #456 first removed the "Other" fold everywhere, so every category was its
 * own band. For People Impact that meant ~689 bands, almost all of them
 * sub-pixel slivers that couldn't be labelled, told apart, or reliably
 * hovered, and each one still cost an SVG path. The cap keeps "every
 * category you could plausibly pick out" (100 is far past the five
 * coloured slots, and past what a label can reach) and folds only the long
 * tail below that.
 *
 * Which categories are kept is decided by total across every point, not by
 * the caller's order, so a caller that orders by something else (a fixed
 * category ladder, say) still drops its smallest, never its last. The kept
 * ones stay in the caller's order: stacking order is the caller's call.
 * "Other" goes last, on top of the stack.
 *
 * Pure re-shaping of points the chart already has, the same boundary as
 * `bin.ts`.
 */

export const AREA_MAX_BANDS = 100;
export const AREA_OTHER_ID = "__other__";

export function capAreaCategories<C extends { id: string }, P extends { values: Record<string, number> }>(
  categories: readonly C[],
  points: readonly P[],
  max: number = AREA_MAX_BANDS,
): { kept: C[]; folded: boolean; points: P[] } {
  if (categories.length <= max) return { kept: [...categories], folded: false, points: [...points] };

  const totals = new Map<string, number>(categories.map((c) => [c.id, 0]));
  for (const p of points) {
    for (const [id, v] of Object.entries(p.values)) {
      if (totals.has(id)) totals.set(id, (totals.get(id) as number) + v);
    }
  }
  // Ties broken by the caller's order, so the cut is stable across renders.
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const keepIds = new Set(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || (order.get(a[0]) as number) - (order.get(b[0]) as number))
      .slice(0, max)
      .map(([id]) => id),
  );

  const folded = points.map((p) => {
    const values: Record<string, number> = {};
    let other = 0;
    for (const [id, v] of Object.entries(p.values)) {
      if (keepIds.has(id)) values[id] = v;
      else other += v;
    }
    if (other !== 0) values[AREA_OTHER_ID] = other;
    return { ...p, values };
  });

  return { kept: categories.filter((c) => keepIds.has(c.id)), folded: true, points: folded };
}
