import { computeRankings, STANDARD_RANK_WINDOWS, type RankAppearance, type RankMovement } from "@/lib/ranking";

/**
 * The place leaderboard's rows (#115), assembled from raw day rows and the
 * place catalog. Pure, so the ranking rules can be tested without a
 * database — `getPlaceLeaderboardData` (src/lib/charts.ts) only fetches.
 *
 * Why this moved out of SQL: the first version (#22) was a single
 * `GROUP BY` returning a total per place. Movement needs the standing *at
 * several past moments* (see src/lib/ranking.ts for that definition),
 * which is the same all-time total cut off at different dates — cheap in
 * one pass over ~4k day rows, awkward as four more aggregate queries.
 */

/** Legacy `location_leaderboard`'s weighting: a day's first place slot
 * counts double the second. The recap uses the same pair
 * (src/lib/recap-people-places.ts) so the two can't disagree about what
 * "most mentioned" means. */
export const PLACE_SLOT_WEIGHTS = [2, 1] as const;

export type PlaceLeaderboardEntry = {
  id: number;
  name: string;
  /** Ancestors from root down, excluding the place itself — e.g. a
   * neighbourhood's `["USA", "Georgia", "Atlanta"]`. Empty for a root
   * place; null where the caller has no hierarchy to offer (the recap). */
  path: string[] | null;
  /** Slot-weighted mentions — see PLACE_SLOT_WEIGHTS. */
  value: number;
  /** The root ("country") ancestor's colour — `places.color` is only ever
   * set on a top-level place (see schema.ts). */
  color: string | null;
  /** Current rank, ties sharing the better one. */
  rank: number;
  /** Per `STANDARD_RANK_WINDOWS` id; null where movement wasn't computed. */
  movements: Record<string, RankMovement> | null;
  /** Weighted mentions gained inside each window. */
  gained: Record<string, number> | null;
};

export type PlaceLeaderboardDay = { date: string; place1Id: number | null; place2Id: number | null };

export type PlaceCatalogRow = {
  id: number;
  name: string;
  /** "<id>/<id>/.../<id>/" root to self; null until backfilled. */
  idPath: string | null;
  rootColor: string | null;
};

/**
 * Every place that's been logged, ranked by weighted mentions, with rank
 * movement over the standard week / month / year windows.
 *
 * The path is resolved from `idPath` against the catalog's names rather
 * than split out of `namePath`, because a place name can itself contain a
 * "/" ("Bar/Restaurant"), which would silently split into two ancestors.
 *
 * Windows are anchored on the latest logged day, not today, so a gap in
 * logging doesn't read as every place standing still.
 */
export function buildPlaceLeaderboard(
  dayRows: PlaceLeaderboardDay[],
  catalog: PlaceCatalogRow[],
): PlaceLeaderboardEntry[] {
  const appearances: RankAppearance[] = [];
  let asOf = "";
  for (const day of dayRows) {
    [day.place1Id, day.place2Id].forEach((id, slot) => {
      if (id === null) return;
      appearances.push({ key: String(id), date: day.date, weight: PLACE_SLOT_WEIGHTS[slot] });
    });
    if (day.date > asOf) asOf = day.date;
  }
  if (appearances.length === 0) return [];

  const byId = new Map(catalog.map((p) => [p.id, p]));
  const pathOf = (place: PlaceCatalogRow): string[] => {
    if (!place.idPath) return [];
    const ids = place.idPath.split("/").filter(Boolean).map(Number);
    return ids
      .slice(0, -1)
      .map((id) => byId.get(id)?.name)
      .filter((name): name is string => name !== undefined);
  };

  return computeRankings(appearances, asOf, STANDARD_RANK_WINDOWS).map((item) => {
    const id = Number(item.key);
    const place = byId.get(id);
    return {
      id,
      name: place?.name ?? "Unknown",
      path: place ? pathOf(place) : [],
      value: item.total,
      color: place?.rootColor ?? null,
      rank: item.rank,
      movements: item.movements,
      gained: item.counts,
    };
  });
}
