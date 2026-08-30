/**
 * Shared place-list ordering — used both server-side (the /manage/places
 * list) and client-side (the parent picker in place-detail.tsx,
 * new-place-modal.tsx, places-entry-form.tsx). Deliberately has no DB or
 * server-only dependencies (unlike src/lib/days.ts) so client components
 * can import it directly without pulling drizzle/neon into the client
 * bundle.
 */

type PlaceLike = { id: number; name: string; namePath: string | null };

/** Depth in the place hierarchy, root = 0 — derived from the maintained
 * namePath column ("USA/Georgia/Atlanta/" has 3 segments -> depth 2, see
 * the `places` table comment in schema.ts) rather than a DB round trip,
 * since every place we sort already carries its own namePath. */
export function placeDepth(namePath: string | null): number {
  if (!namePath) return 0;
  return namePath.split("/").filter(Boolean).length - 1;
}

/** Most-mentioned first (own + every descendant's — see
 * getPlaceMentionCounts in src/lib/days.ts), then shallower places before
 * deeper ones so a parent/grandparent/etc. always sorts above its own
 * descendants when they're tied on mentions — which is the common case
 * (an unmentioned country and its unmentioned cities are all tied at 0,
 * and alphabetical order alone would otherwise shuffle a city above its
 * own country). Name is the final tiebreak, for genuine siblings tied on
 * both count and depth. */
export function comparePlacesByMentions(mentionCounts: Map<number, number>) {
  return (a: PlaceLike, b: PlaceLike): number => {
    const countDiff = (mentionCounts.get(b.id) ?? 0) - (mentionCounts.get(a.id) ?? 0);
    if (countDiff !== 0) return countDiff;
    const depthDiff = placeDepth(a.namePath) - placeDepth(b.namePath);
    if (depthDiff !== 0) return depthDiff;
    return a.name.localeCompare(b.name);
  };
}
