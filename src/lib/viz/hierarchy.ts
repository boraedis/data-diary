// Pure, non-visual tree-shaping helpers for the hierarchical primitives
// (#118's InteractiveDonut is the first consumer). Same role `bin.ts`
// plays for series data: re-shaping an *already-fetched* result set into
// the nested form a chart wants, in one tested place, instead of every
// chart page hand-rolling its own recursive builder the way legacy's
// `location_burst.js` did (`structureWorld`/`structureMetros`/
// `filterDepths`, three near-identical hand-written walks in one file).
//
// Same boundary rule as `bin.ts`: this is for re-shaping rows a page has
// already fetched. Bulk aggregation over a chart's full history still
// belongs in SQL — `getPlaceHierarchyData` does its own per-place tally in
// Postgres and only hands the flat, already-counted rows here.

/**
 * The nested shape every hierarchical chart in this toolkit consumes.
 * Deliberately minimal and domain-free — a places tree, a tag tree, and a
 * category tree are all just this.
 */
export type HierarchyDatum = {
  /** Stable identity for this node among its siblings — used for React
   * keys, for remembering which node a chart is zoomed into across a
   * re-render, and for de-duplication while building. Must be unique
   * within a parent; a globally-unique id (a DB row id) is ideal. */
  key: string;
  /** Display name. User-entered data (place names, tag names) — never
   * interpolated into markup by consumers, only set as text. */
  name: string;
  /** This node's *own* value, excluding its children's. A day logged at
   * "Atlanta" directly, rather than at a place inside Atlanta, is
   * Atlanta's own value; a chart sums own + descendants (d3's
   * `hierarchy.sum` does exactly this). Omit or 0 for a pure grouping
   * node that was never itself logged. */
  value?: number;
  /** A shorter stand-in a chart may substitute when the full `name`
   * won't fit — a place's catalog alias, an abbreviation. Only ever used
   * for a cramped on-chart label; tooltips, breadcrumbs and any readout
   * still show `name`, so the shorthand never becomes the only spelling
   * the reader can get at. */
  shortName?: string;
  /** Explicit color for the branch rooted at this node, when the entity
   * genuinely owns a color in the data (`places.color`, a tag's color).
   * Omit to let the chart assign one from the categorical palette. */
  color?: string;
  children?: HierarchyDatum[];
};

/** Total of `value` over a node and every descendant. Chart code normally
 * gets this from d3's `hierarchy.sum()` instead — this exists for the
 * pruning/folding helpers below, which run *before* any d3 layout. */
export function sumValues(node: HierarchyDatum): number {
  return (node.value ?? 0) + (node.children ?? []).reduce((total, child) => total + sumValues(child), 0);
}

/**
 * Builds a nested tree from flat rows that each name their own parent —
 * the shape a self-referencing table (`places.parentId`) comes back as.
 * Rows whose parent key isn't present in `rows` are treated as roots, so a
 * partial fetch (or a dangling parent reference) still renders instead of
 * silently dropping a whole branch.
 *
 * Cycle-safe on purpose, not defensively: this repo has actually had
 * `places.parentId` corrupted into a self-reference by a bad upsert (see
 * `places`' own schema comment and scripts/split-duplicate-places.mjs). A
 * naive builder infinite-loops on that; here, a row whose ancestry walks
 * back into itself is re-attached at the root rather than taking the
 * whole chart down.
 */
export function buildTreeFromParents<Row>(
  rows: Row[],
  options: {
    rootName: string;
    rootKey?: string;
    toNode: (row: Row) => HierarchyDatum;
    parentKeyOf: (row: Row) => string | null;
  },
): HierarchyDatum {
  const { rootName, rootKey = "__root__", toNode, parentKeyOf } = options;

  const nodes = new Map<string, HierarchyDatum>();
  const parentKeys = new Map<string, string | null>();
  for (const row of rows) {
    const node = toNode(row);
    // Last row wins on a duplicate key rather than producing two nodes
    // that would each get half the tree hung off them.
    nodes.set(node.key, node);
    parentKeys.set(node.key, parentKeyOf(row));
  }

  const root: HierarchyDatum = { key: rootKey, name: rootName, children: [] };

  /** Walks up from `key`, returning false the moment it revisits a key it
   * already passed through on this walk (a cycle) or runs out of parents. */
  const hasCycle = (key: string): boolean => {
    const seen = new Set<string>([key]);
    let current = parentKeys.get(key) ?? null;
    while (current != null && nodes.has(current)) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = parentKeys.get(current) ?? null;
    }
    return false;
  };

  for (const [key, node] of nodes) {
    const parentKey = parentKeys.get(key) ?? null;
    const parent = parentKey != null && !hasCycle(key) ? nodes.get(parentKey) : undefined;
    const target = parent ?? root;
    (target.children ??= []).push(node);
  }

  return root;
}

/**
 * Builds a nested tree by grouping rows down a fixed list of level
 * accessors — "category, then subcategory, then the row itself." Each
 * level's `null`/empty value collapses into that level's `fallback` label
 * (e.g. "Uncategorized") rather than dropping the row, so a total taken
 * over the tree still matches a total taken over `rows`.
 *
 * Intermediate levels get no `value` of their own — they're pure grouping
 * nodes, and their weight comes entirely from the leaves beneath them.
 */
export function buildTreeFromLevels<Row>(
  rows: Row[],
  options: {
    rootName: string;
    rootKey?: string;
    levels: { of: (row: Row) => string | null | undefined; fallback: string }[];
    toLeaf: (row: Row) => HierarchyDatum;
  },
): HierarchyDatum {
  const { rootName, rootKey = "__root__", levels, toLeaf } = options;
  const root: HierarchyDatum = { key: rootKey, name: rootName, children: [] };

  for (const row of rows) {
    let node = root;
    let keyPrefix = "";
    for (const level of levels) {
      const raw = level.of(row);
      const name = raw == null || raw === "" ? level.fallback : raw;
      // Group keys are path-scoped ("Restaurant/Cafe"), not bare names —
      // two different categories can legitimately share a subcategory
      // name, and a bare name would merge them into one node.
      keyPrefix = `${keyPrefix}${name}/`;
      let child = (node.children ??= []).find((c) => c.key === keyPrefix);
      if (!child) {
        child = { key: keyPrefix, name, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    (node.children ??= []).push(toLeaf(row));
  }

  return root;
}

/**
 * Drops every branch that sums to zero (or less). A places catalog holds
 * every place ever created, most of which aren't in the current chart's
 * date range — without this, a sunburst spends its rings on
 * zero-width arcs that can never be seen or clicked.
 *
 * Returns `null` when the node itself sums to zero, so a caller pruning a
 * root gets an explicit "nothing to draw" rather than an empty husk.
 */
export function pruneEmptyBranches(node: HierarchyDatum): HierarchyDatum | null {
  if (sumValues(node) <= 0) return null;
  const children = (node.children ?? [])
    .map(pruneEmptyBranches)
    .filter((child): child is HierarchyDatum => child !== null);
  return { ...node, children: children.length > 0 ? children : undefined };
}

/**
 * Keeps the `keep` largest children of `node` and rolls the rest into one
 * "Other" child that still holds them as its own children (so the tail is
 * grouped, not hidden — it stays drillable).
 *
 * This is the categorical-palette rule made mechanical, not a cosmetic
 * tidy-up: `categoricalColor` has exactly 5 real slots and never cycles,
 * and the documented way to handle a 6th category is to fold it into
 * "Other" *before* asking for a color. A consumer whose top-level entities
 * carry their own real colors in the data (`places.color`) doesn't need
 * this — those aren't palette slots being reused, they're author-assigned
 * identity colors.
 *
 * Only ever folds the top level it's called on; descendants are untouched
 * (deeper rings inherit their branch's hue, so they were never competing
 * for palette slots in the first place).
 */
export function foldTailIntoOther(
  node: HierarchyDatum,
  options: { keep: number; otherName?: string; otherKey?: string } = { keep: 5 },
): HierarchyDatum {
  const { keep, otherName = "Other", otherKey = "__other__" } = options;
  const children = node.children ?? [];
  // keep + 1 would fold exactly one child into an "Other" that's strictly
  // worse than just showing it — no fold below that.
  if (children.length <= keep + 1) return node;

  const ranked = [...children].sort((a, b) => sumValues(b) - sumValues(a));
  const kept = ranked.slice(0, keep);
  const tail = ranked.slice(keep);

  return {
    ...node,
    children: [...kept, { key: otherKey, name: otherName, children: tail }],
  };
}
