import { describe, expect, it } from "vitest";
import { buildPlaceLeaderboard, type MetroRow, type PlaceCatalogRow } from "@/lib/leaderboards/places";

// The place leaderboard's four modes (#115): slot weighting, the region /
// metro / category roll-ups, ancestor paths and root colours. The movement
// rules themselves are pinned in ranking.test.ts.

const region = (subcategory: string) => ({ category: "Region", subcategory });

const catalog: PlaceCatalogRow[] = [
  { id: 1, name: "USA", idPath: "1/", rootColor: "#123456", ...region("Country"), metroId: null },
  { id: 2, name: "Georgia", idPath: "1/2/", rootColor: "#123456", ...region("State/Province"), metroId: null },
  { id: 3, name: "Atlanta", idPath: "1/2/3/", rootColor: "#123456", ...region("Municipality"), metroId: 7 },
  { id: 4, name: "Midtown", idPath: "1/2/3/4/", rootColor: "#123456", ...region("Neighborhood"), metroId: null },
  { id: 5, name: "Bar/Restaurant", idPath: "1/2/3/4/5/", rootColor: "#123456", category: "Bar", subcategory: "Pub", metroId: null },
  // Filed straight under the city: no neighbourhood above it.
  { id: 6, name: "Home", idPath: "1/2/3/6/", rootColor: "#123456", category: "Residence", subcategory: null, metroId: null },
  { id: 8, name: "Unbackfilled", idPath: null, rootColor: null, category: null, subcategory: null, metroId: null },
];

const metros: MetroRow[] = [{ id: 7, name: "Metro Atlanta", country: "USA" }];

/** Name and days, to 2dp — a day splits ⅔ / ⅓ between its two slots. */
const names = (rows: { name: string; value: number }[]) => rows.map((r) => [r.name, Math.round(r.value * 100) / 100]);

describe("buildPlaceLeaderboard", () => {
  const days = [
    { date: "2026-01-01", place1Id: 6, place2Id: 5 },
    { date: "2026-01-02", place1Id: 5, place2Id: null },
  ];

  it("splits each day ⅔ to its first place and ⅓ to its second", () => {
    const rows = buildPlaceLeaderboard(days, catalog, metros, { mode: "place" });
    expect(names(rows)).toEqual([
      ["Bar/Restaurant", 1],
      ["Home", 0.67],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("resolves the path by id, so a '/' inside a name can't split it", () => {
    const rows = buildPlaceLeaderboard(days, catalog, metros, { mode: "place" });
    expect(rows[0].context).toEqual("USA › Georgia › Atlanta › Midtown");
    expect(rows[0].color).toBe("#123456");
  });

  it("rolls mentions up to the region of the chosen level", () => {
    const city = buildPlaceLeaderboard(days, catalog, metros, { mode: "region", level: "Municipality" });
    // Every place logged is in Atlanta; day 2 only filled its first slot.
    expect(names(city)).toEqual([["Atlanta", 1.67]]);
    expect(city[0].context).toBe("USA › Georgia");

    // Home sits under no neighbourhood, so it drops out rather than being
    // guessed into one.
    const hood = buildPlaceLeaderboard(days, catalog, metros, { mode: "region", level: "Neighborhood" });
    expect(names(hood)).toEqual([["Midtown", 1]]);
  });

  it("rolls everything beneath a city into its metro", () => {
    const rows = buildPlaceLeaderboard(days, catalog, metros, { mode: "metro" });
    expect(names(rows)).toEqual([["Metro Atlanta", 1.67]]);
    expect(rows[0].context).toBe("USA");
  });

  it("groups by category or subcategory", () => {
    const cats = buildPlaceLeaderboard(days, catalog, metros, { mode: "category", level: "category" });
    expect(names(cats)).toEqual([
      ["Bar", 1],
      ["Residence", 0.67],
    ]);
    const subs = buildPlaceLeaderboard(days, catalog, metros, { mode: "category", level: "subcategory" });
    expect(subs.map((r) => [r.name, r.detail])).toEqual([
      ["Pub", "Bar"],
      ["Uncategorized", "Residence"],
    ]);
  });

  it("tolerates a place with no idPath", () => {
    const rows = buildPlaceLeaderboard([{ date: "2026-01-01", place1Id: 8, place2Id: null }], catalog, metros, {
      mode: "place",
    });
    expect(rows[0]).toMatchObject({ name: "Unbackfilled", context: "Unbackfilled", color: null });
  });

  it("anchors movement windows on the latest logged day", () => {
    // Home led until the bar overtook it three days before the last entry.
    const rows = buildPlaceLeaderboard(
      [
        { date: "2025-06-01", place1Id: 6, place2Id: null },
        { date: "2025-06-10", place1Id: 5, place2Id: null },
        { date: "2025-06-11", place1Id: 5, place2Id: null },
      ],
      catalog,
      metros,
      { mode: "place" },
    );
    const bar = rows.find((r) => r.name === "Bar/Restaurant")!;
    const home = rows.find((r) => r.name === "Home")!;
    // [week, month, year]: the bar wasn't ranked a week or more ago.
    expect(bar.previousRanks).toEqual([null, null, null]);
    expect(home.previousRanks).toEqual([1, null, null]);
    expect(bar.gained).toEqual([1.333, 1.333, 1.333]);
  });

  it("returns nothing when no place was ever logged", () => {
    expect(
      buildPlaceLeaderboard([{ date: "2026-01-01", place1Id: null, place2Id: null }], catalog, metros, { mode: "place" }),
    ).toEqual([]);
  });
});
