import * as d3 from "d3";
import { categoricalColor, CATEGORICAL_SLOT_COUNT } from "@/lib/viz/color";
import type { HierarchyDatum } from "@/lib/viz/hierarchy";

// d3-aware helpers shared by the hierarchical primitives — InteractiveDonut
// (#118) and InteractiveTreemap (#213). They lived inside the donut until
// the treemap needed them too; moved here rather than imported across
// component files, because a treemap and a sunburst over the same tree
// must agree on what a node's identity (its key path) and its colour are
// — two copies would drift the first time one of them was tuned.
//
// `hierarchy.ts` stays d3-free on purpose (its builders run *before* any
// layout); everything here operates on a d3 `HierarchyNode` *after*
// `d3.hierarchy()`, which is the line between the two files.

/** Root-relative path of `key`s identifying a node — the root itself
 * contributes nothing, so `[]` means "the root". Stable across a
 * re-layout (unlike a node object), which is what makes it usable as the
 * remembered focus across a resize. */
export function keyPathOf(node: d3.HierarchyNode<HierarchyDatum>): string[] {
  return node
    .ancestors()
    .reverse()
    .slice(1)
    .map((n) => n.data.key);
}

/** Resolves a `keyPathOf` result back to a live node, or `null` if that
 * path no longer exists (the data changed under a remembered focus). */
export function findByKeyPath<T extends d3.HierarchyNode<HierarchyDatum>>(root: T, path: string[]): T | null {
  let node: T = root;
  for (const key of path) {
    const next = (node.children as T[] | undefined)?.find((child) => child.data.key === key);
    if (!next) return null;
    node = next;
  }
  return node;
}

/**
 * Default fill: every arc (or treemap tile) takes the color of the depth-1
 * branch it belongs to, so a whole branch reads as one family and depth
 * is carried by a tint (below) rather than by a second hue.
 *
 * A branch whose data carries its own `color` uses it — that's an
 * author-assigned identity color (`places.color`, set per country), not a
 * palette slot, so there's no "never cycle" concern with having more than
 * five of them. Branches without one fall back to `categoricalColor` by
 * rank, wrapped modulo `CATEGORICAL_SLOT_COUNT` rather than left to fall
 * through to `categoricalColor`'s own muted-gray overflow.
 *
 * This is a deliberate exception, shared by the sunburst and the treemap, to
 * `categoricalColor`'s repo-wide "never cycle" rule (still the right
 * default everywhere else it's called — a legend or a bar chart repaints
 * nothing when a series drops out precisely *because* nothing cycles).
 * What's different here: a branch's hue is fixed for the branch's whole
 * lifetime regardless of how many siblings it has (rank, not a filtered
 * survivor count, decides the slot), and #166 gave every branch — colored
 * or not — its own undo: excluding a slice, not a repainted uncolored
 * tail, is now how a reader gets down to "just the distinguishable ones."
 * A consumer with many uncolored top-level branches (`PlaceHierarchyExplorer`'s
 * category/metro modes, since #166 stopped folding their tail into
 * "Other") would otherwise paint most of the ring one flat gray, which
 * reads as "these are all the same" rather than "these are many" — two
 * branches sharing a hue by wrapping are still visually distinct from
 * each other (rank, position, label, tooltip), which uniform gray never
 * was.
 */
export function defaultColorOf(node: d3.HierarchyNode<HierarchyDatum>): string {
  const branch = node.depth <= 1 ? node : node.ancestors()[node.depth - 1];
  if (branch?.data.color) return branch.data.color;
  const siblings = branch?.parent?.children ?? [];
  const rank = Math.max(0, siblings.indexOf(branch));
  return categoricalColor(rank % CATEGORICAL_SLOT_COUNT);
}

/**
 * How much white is mixed into a branch's base color at each ring out
 * from the center. Index 0 is the innermost visible ring, which always
 * gets the color at full strength.
 *
 * This used to be a fill-opacity ramp (0.85 down to 0.35, the Observable
 * original's idea), and on the app's dark theme that was plainly wrong:
 * fading a fill toward a dark surface doesn't lighten it, it drains it,
 * so the outer rings went muddy and the whole chart read as washed out.
 * Mixing toward white instead lightens in both themes and holds far more
 * chroma than blending against the background ever could — even in light
 * mode, where the old ramp was effectively a 47% white mix by the third
 * ring, this is 19%.
 *
 * Steps are relative to whatever is currently focused, not to absolute
 * tree depth, so the innermost ring is full-strength at every zoom level
 * rather than the palette draining away the deeper you drill.
 */
const DEPTH_TINTS = [0, 0.1, 0.19, 0.26, 0.32] as const;

/**
 * Base color for a node, tinted for its ring. Deliberately a CSS
 * `color-mix()` string rather than a color computed in JS: the base is
 * usually a `var(--chart-N)` token, and resolving that to real channel
 * values would freeze the chart at whichever theme was live when it
 * rendered. Letting CSS do the mixing keeps light/dark switching
 * automatic, and lets a plain CSS transition interpolate the fill during
 * a zoom (see `draw`) — d3 can't tween these strings, but the browser
 * interpolates their computed colors natively.
 */
export function depthFill(base: string, ringIndex: number): string {
  const tint = DEPTH_TINTS[Math.min(Math.max(ringIndex, 0), DEPTH_TINTS.length - 1)];
  if (tint === 0) return base;
  return `color-mix(in oklch, ${base}, white ${Math.round(tint * 100)}%)`;
}
