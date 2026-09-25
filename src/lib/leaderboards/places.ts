import { alias } from "drizzle-orm/pg-core";
import { isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, metros, places } from "@/db/schema";
import { computeRankings, STANDARD_RANK_WINDOWS, type RankAppearance } from "@/lib/ranking";
import { toLeaderboardRows, type LeaderboardColumns, type LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// The places leaderboard (#115): slot-weighted days at each place, ranked
// four ways — by place, by the region it sits in, by metro, and by
// category. Every mode is the same appearances fed through
// `computeRankings`; only the key a mention is credited to changes.
//
// Pure (`buildPlaceLeaderboard`) plus a fetcher, the split the rest of
// src/lib uses, so the roll-up rules are testable without a database.
//
// Why this isn't a GROUP BY: movement needs the standing at several past
// dates (see src/lib/ranking.ts), which is the same total cut off at
// different points — cheap in one pass over ~4k days, awkward as SQL, and
// the roll-ups below walk the place tree, which is easier in code than in
// recursive CTEs.

/** Legacy `location_leaderboard`'s weighting: a day's first place slot
 * counts double the second. The recap uses the same pair
 * (src/lib/recap-people-places.ts) so the two can't disagree about what
 * "most mentioned" means. */
export const PLACE_SLOT_WEIGHTS = [2, 1] as const;

/**
 * Each slot's share of one day — the legacy weights divided by their sum
 * (#428), so a place's total reads as **days** rather than as legacy's
 * unitless 2-and-1 "mentions": ⅔ of a day to the first place, ⅓ to the
 * second, and a full day when the same place fills both. Every logged day
 * fills both slots (checked when this changed: 3,870 of 3,870), so a whole
 * table's days sum to the days logged. Ranking is untouched — it's the
 * same weighting at a third of the scale.
 */
export const PLACE_SLOT_DAY_SHARES = PLACE_SLOT_WEIGHTS.map(
  (w) => w / PLACE_SLOT_WEIGHTS.reduce((sum, x) => sum + x, 0),
);

export type PlaceMode = "place" | "region" | "metro" | "category";

export const PLACE_MODES: LeaderboardOption<PlaceMode>[] = [
  { id: "place", label: "Top Places" },
  { id: "region", label: "Top Regions" },
  { id: "metro", label: "Top Metros" },
  { id: "category", label: "Top Categories" },
];

/**
 * Region levels — the catalog's own `Region` subcategories, which is what
 * makes this reliable where tree depth isn't. Depth 4 is *usually* a
 * neighbourhood, but a restaurant filed straight under a small town is at
 * depth 4 too; a place explicitly categorised Region › Neighborhood only
 * ever means one thing. The rarer Region subcategories (District, Island,
 * National Park) aren't offered: a handful of rows each, and none of them
 * is a level the whole tree shares.
 */
export type RegionLevel = "Country" | "State/Province" | "Municipality" | "Neighborhood";

export const REGION_LEVELS: LeaderboardOption<RegionLevel>[] = [
  { id: "Country", label: "Country" },
  { id: "State/Province", label: "State/Province" },
  { id: "Municipality", label: "Municipality" },
  { id: "Neighborhood", label: "Neighborhood" },
];

export type CategoryLevel = "category" | "subcategory";

export const CATEGORY_LEVELS: LeaderboardOption<CategoryLevel>[] = [
  { id: "category", label: "Category" },
  { id: "subcategory", label: "Subcategory" },
];

export type PlaceLeaderboardDay = { date: string; place1Id: number | null; place2Id: number | null };

export type PlaceCatalogRow = {
  id: number;
  name: string;
  /** "<id>/<id>/.../<id>/" root to self; null until backfilled. */
  idPath: string | null;
  rootColor: string | null;
  category: string | null;
  subcategory: string | null;
  metroId: number | null;
};

export type MetroRow = { id: number; name: string; country: string | null };

export type PlaceLeaderboardOptions =
  | { mode: "place" }
  | { mode: "region"; level: RegionLevel }
  | { mode: "metro" }
  | { mode: "category"; level: CategoryLevel };

/**
 * Ranks slot-weighted days (see PLACE_SLOT_DAY_SHARES) under one of the four modes.
 *
 * - **place** — each place on its own.
 * - **region** — each mention credited to the nearest ancestor-or-self
 *   that's a Region of the chosen level. A mention with no such ancestor
 *   (a country logged directly, when ranking neighbourhoods) is dropped
 *   rather than guessed into one.
 * - **metro** — credited to the nearest ancestor-or-self with a metro set.
 *   Metros are assigned at the municipality level, so everything beneath a
 *   city accumulates into it; a mention outside any metro is dropped.
 * - **category** — by the place's own category, or category › subcategory.
 *
 * Paths come from `idPath` resolved against catalog names, not from
 * `namePath`, because a name can itself contain a "/" ("Bar/Restaurant").
 * Windows anchor on the latest logged day, not today.
 */
export function buildPlaceLeaderboard(
  dayRows: PlaceLeaderboardDay[],
  catalog: PlaceCatalogRow[],
  metroRows: MetroRow[],
  options: PlaceLeaderboardOptions,
): LeaderboardRow[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const metroById = new Map(metroRows.map((m) => [m.id, m]));

  /** Root-to-self chain of catalog rows. */
  const chainOf = (place: PlaceCatalogRow): PlaceCatalogRow[] => {
    if (!place.idPath) return [place];
    const chain = place.idPath
      .split("/")
      .filter(Boolean)
      .map((id) => byId.get(Number(id)))
      .filter((p): p is PlaceCatalogRow => p !== undefined);
    return chain.length > 0 ? chain : [place];
  };
  const pathOf = (place: PlaceCatalogRow) => chainOf(place).slice(0, -1).map((p) => p.name);

  /** Where a mention of `place` is credited under the current mode — a
   * ranking key plus how to label it — or null to drop it. */
  type Credit = { key: string; name: string; detail?: string | null; context?: string | null; color?: string | null };
  const creditCache = new Map<number, Credit | null>();
  const creditFor = (place: PlaceCatalogRow): Credit | null => {
    switch (options.mode) {
      case "place": {
        const path = pathOf(place);
        return {
          key: String(place.id),
          name: place.name,
          // A root place (a country) is its own path, so its row isn't a
          // blank in a column of coloured ones.
          context: path.length > 0 ? path.join(" › ") : place.name,
          color: place.rootColor,
        };
      }
      case "region": {
        const region = [...chainOf(place)]
          .reverse()
          .find((p) => p.category === "Region" && p.subcategory === options.level);
        if (!region) return null;
        const path = pathOf(region);
        return {
          key: String(region.id),
          name: region.name,
          context: path.length > 0 ? path.join(" › ") : region.name,
          color: region.rootColor,
        };
      }
      case "metro": {
        const withMetro = [...chainOf(place)].reverse().find((p) => p.metroId !== null);
        const metro = withMetro?.metroId != null ? metroById.get(withMetro.metroId) : undefined;
        if (!metro || !withMetro) return null;
        return {
          key: String(metro.id),
          name: metro.name,
          context: metro.country ?? chainOf(withMetro)[0].name,
          color: withMetro.rootColor,
        };
      }
      case "category": {
        if (!place.category) return null;
        if (options.level === "category") return { key: place.category, name: place.category };
        const sub = place.subcategory ?? "Uncategorized";
        return { key: `${place.category}\u0000${sub}`, name: sub, detail: place.category };
      }
    }
  };

  const appearances: RankAppearance[] = [];
  const labels = new Map<string, Credit>();
  let asOf = "";
  for (const day of dayRows) {
    if (day.date > asOf) asOf = day.date;
    [day.place1Id, day.place2Id].forEach((id, slot) => {
      if (id === null) return;
      const place = byId.get(id);
      if (!place) return;
      let credit = creditCache.get(id);
      if (credit === undefined) {
        credit = creditFor(place);
        creditCache.set(id, credit);
      }
      if (!credit) return;
      labels.set(credit.key, credit);
      appearances.push({ key: credit.key, date: day.date, weight: PLACE_SLOT_DAY_SHARES[slot] });
    });
  }
  if (appearances.length === 0) return [];

  const ranked = computeRankings(appearances, asOf, STANDARD_RANK_WINDOWS);
  return toLeaderboardRows(ranked, STANDARD_RANK_WINDOWS, (key) => labels.get(key) ?? { name: "Unknown" });
}

export const PLACE_DAYS_DESCRIPTION =
  "Days, split by slot: each logged day gives ⅔ to its first place and ⅓ to its second (a full day when both are the same place).";

export function placeColumns(options: PlaceLeaderboardOptions): LeaderboardColumns {
  const base = {
    valueHeader: "Days",
    valueDescription: PLACE_DAYS_DESCRIPTION,
    valueFormat: "days" as const,
    gainedNoun: "days gained",
  };
  switch (options.mode) {
    case "place":
      return {
        ...base,
        nameHeader: "Place",
        contextHeader: "Path",
        contextDescription: "Where the place sits in the hierarchy, coloured by its country.",
      };
    case "region":
      // A country is its own root, so its path column would only repeat
      // the name — drop it and let the country colour tint the name.
      if (options.level === "Country") return { ...base, nameHeader: "Country" };
      return {
        ...base,
        nameHeader: options.level,
        contextHeader: "Path",
        contextDescription: `Every day at a place inside this ${options.level.toLowerCase()} counts toward it.`,
      };
    case "metro":
      return {
        ...base,
        nameHeader: "Metro",
        contextHeader: "Country",
        contextDescription: "Every day at a place inside the metro counts toward it.",
      };
    case "category":
      return { ...base, nameHeader: options.level === "category" ? "Category" : "Subcategory" };
  }
}

// places.color is only ever set on a top-level ("country") place — see
// that column's own comment in schema.ts — so a place's "country colour"
// is its root ancestor's. idPath's first segment is always the root's id,
// so self-joining against it gives the root row (a root joins itself).
// Left-joined: idPath is null until backfilled and a root may have no
// colour — both fall back to an uncoloured cell.
const rootPlaces = alias(places, "root_places");

/** Fetches everything `buildPlaceLeaderboard` needs. No top-N limit: the
 * table shows every place and renders progressively. */
export async function getPlaceLeaderboardData(options: PlaceLeaderboardOptions): Promise<LeaderboardRow[]> {
  const db = getDb();
  const [dayRows, catalog, metroRows] = await Promise.all([
    db
      .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
      .from(days)
      .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id))),
    db
      .select({
        id: places.id,
        name: places.name,
        idPath: places.idPath,
        rootColor: rootPlaces.color,
        category: places.category,
        subcategory: places.subcategory,
        metroId: places.metroId,
      })
      .from(places)
      .leftJoin(rootPlaces, sql`${rootPlaces.id} = nullif(split_part(${places.idPath}, '/', 1), '')::int`),
    db.select({ id: metros.id, name: metros.name, country: metros.country }).from(metros),
  ]);
  return buildPlaceLeaderboard(dayRows, catalog, metroRows, options);
}
