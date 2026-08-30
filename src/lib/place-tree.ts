/**
 * Client-safe tree helpers for the places "World view" (src/components/
 * manage/place-world-tree.tsx). Builds an in-memory forest from the flat
 * `listPlacesCatalog()` result instead of drilling down one level per
 * click against the API (unlike legacy's world.js Miller-columns UI, which
 * had to — its `world` collection was hand-maintained and there was no
 * cheap "give me everything" query). At this app's personal scale (a few
 * hundred places at most) fetching the whole flat list once and nesting it
 * client-side is simpler and faster than paginated/lazy drill-down, and
 * it's the same data the flat places list already fetches — see the
 * `places` table comment in schema.ts for why parentId is the only source
 * of truth and idPath/namePath are just a maintained denormalization.
 *
 * No DB or server-only dependencies (unlike src/lib/days.ts), same
 * reasoning as src/lib/place-sort.ts — client components import this
 * directly without pulling drizzle/neon into the client bundle.
 */

type PlaceLike = {
  id: number;
  name: string;
  parentId: number | null;
  namePath: string | null;
};

export type PlaceNode<T extends PlaceLike> = {
  place: T;
  children: PlaceNode<T>[];
};

/** Nests a flat place list into a forest of root-place trees (parentId ===
 * null). A place whose parentId points at another place NOT present in the
 * input list (shouldn't happen — parentId has a real FK — but see
 * scripts/diagnose-place-cycles.mjs for how corrupted data has slipped in
 * before) is treated as its own root too, rather than silently dropped,
 * so a data problem shows up as a place in an unexpected spot instead of
 * one that just vanishes from the tree. Children within each node are
 * sorted by the given comparator (typically comparePlacesByMentions from
 * place-sort.ts). */
export function buildPlaceForest<T extends PlaceLike>(places: T[], compare: (a: T, b: T) => number): PlaceNode<T>[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const childrenByParent = new Map<number, T[]>();
  const roots: T[] = [];

  for (const p of places) {
    if (p.parentId !== null && byId.has(p.parentId)) {
      if (!childrenByParent.has(p.parentId)) childrenByParent.set(p.parentId, []);
      childrenByParent.get(p.parentId)!.push(p);
    } else {
      roots.push(p);
    }
  }

  function toNode(p: T): PlaceNode<T> {
    const kids = (childrenByParent.get(p.id) ?? []).slice().sort(compare);
    return { place: p, children: kids.map(toNode) };
  }

  return roots.slice().sort(compare).map(toNode);
}

/** Every id reachable from `id` via parentId, NOT including `id` itself —
 * used both to exclude a place (and its own subtree) from its own "move"
 * picker, and to show a descendant count in the move-confirmation step.
 * Same cycle-guard reasoning as getPlaceDescendantIds in src/lib/days.ts:
 * a corrupted parent_id cycle should stop the walk, not hang it. */
export function getDescendantIdSet<T extends PlaceLike>(id: number, places: T[]): Set<number> {
  const childrenByParent = new Map<number, T[]>();
  for (const p of places) {
    if (p.parentId === null) continue;
    if (!childrenByParent.has(p.parentId)) childrenByParent.set(p.parentId, []);
    childrenByParent.get(p.parentId)!.push(p);
  }
  const visited = new Set<number>([id]);
  const result = new Set<number>();
  let frontier = childrenByParent.get(id) ?? [];
  while (frontier.length > 0) {
    const next: T[] = [];
    for (const child of frontier) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      result.add(child.id);
      for (const grandchild of childrenByParent.get(child.id) ?? []) next.push(grandchild);
    }
    frontier = next;
  }
  return result;
}

/** Ids of every place whose name or alias/category/namePath matches
 * `query` (case-insensitive substring), plus every one of their ancestor
 * ids — the second part is what lets the tree auto-expand just enough to
 * reveal each match instead of the caller having to walk parentId chains
 * itself. Returns null (meaning "no filter active") for a blank query. */
export function findMatchingAndAncestorIds<T extends PlaceLike & { alias: string | null; category: string | null }>(
  query: string,
  places: T[]
): { matches: Set<number>; ancestors: Set<number> } | null {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return null;

  const byId = new Map(places.map((p) => [p.id, p]));
  const matches = new Set<number>();
  for (const p of places) {
    const haystack = [p.name, p.alias, p.category].filter(Boolean).join(" ").toLowerCase();
    if (haystack.includes(trimmed)) matches.add(p.id);
  }

  const ancestors = new Set<number>();
  for (const matchId of matches) {
    let current = byId.get(matchId);
    while (current?.parentId !== null && current?.parentId !== undefined) {
      const parent = byId.get(current.parentId);
      if (!parent || ancestors.has(parent.id)) break;
      ancestors.add(parent.id);
      current = parent;
    }
  }

  return { matches, ancestors };
}
