import { describe, expect, it } from "vitest";
import { buildPlaceLeaderboard, type PlaceCatalogRow } from "@/lib/place-leaderboard";

// The place leaderboard's assembly (#115): slot weighting, ancestor paths
// and root colours. The movement rules themselves are pinned in
// ranking.test.ts; these only check that places are fed into them right.

const catalog: PlaceCatalogRow[] = [
  { id: 1, name: "USA", idPath: "1/", rootColor: "#123456" },
  { id: 2, name: "Georgia", idPath: "1/2/", rootColor: "#123456" },
  { id: 3, name: "Bar/Restaurant", idPath: "1/2/3/", rootColor: "#123456" },
  { id: 4, name: "Home", idPath: "1/2/4/", rootColor: "#123456" },
  { id: 5, name: "Unbackfilled", idPath: null, rootColor: null },
];

describe("buildPlaceLeaderboard", () => {
  it("weights a day's first slot double its second", () => {
    const result = buildPlaceLeaderboard(
      [
        { date: "2026-01-01", place1Id: 4, place2Id: 3 },
        { date: "2026-01-02", place1Id: 3, place2Id: null },
      ],
      catalog,
    );
    expect(result.map((r) => [r.name, r.value, r.rank])).toEqual([
      ["Bar/Restaurant", 3, 1],
      ["Home", 2, 2],
    ]);
  });

  it("resolves the ancestor path by id, so a '/' inside a name can't split it", () => {
    const result = buildPlaceLeaderboard([{ date: "2026-01-01", place1Id: 3, place2Id: 1 }], catalog);
    expect(result.find((r) => r.id === 3)!.path).toEqual(["USA", "Georgia"]);
    // A root place has no ancestors.
    expect(result.find((r) => r.id === 1)!.path).toEqual([]);
  });

  it("carries the root colour and tolerates a place with no idPath", () => {
    const result = buildPlaceLeaderboard([{ date: "2026-01-01", place1Id: 5, place2Id: 4 }], catalog);
    expect(result.find((r) => r.id === 5)).toMatchObject({ path: [], color: null });
    expect(result.find((r) => r.id === 4)).toMatchObject({ color: "#123456" });
  });

  it("anchors movement windows on the latest logged day", () => {
    // Home led until Bar overtook it three days before the last entry.
    const result = buildPlaceLeaderboard(
      [
        { date: "2025-06-01", place1Id: 4, place2Id: null },
        { date: "2025-06-10", place1Id: 3, place2Id: null },
        { date: "2025-06-11", place1Id: 3, place2Id: null },
      ],
      catalog,
    );
    const bar = result.find((r) => r.id === 3)!;
    expect(bar.rank).toBe(1);
    expect(bar.movements!.week).toEqual({ delta: null, isNew: true, previousRank: null });
    expect(bar.movements!.month).toEqual({ delta: null, isNew: true, previousRank: null });
    expect(result.find((r) => r.id === 4)!.movements!.week).toEqual({ delta: -1, isNew: false, previousRank: 1 });
    expect(bar.gained!.week).toBe(4);
  });

  it("returns nothing when no place was ever logged", () => {
    expect(buildPlaceLeaderboard([{ date: "2026-01-01", place1Id: null, place2Id: null }], catalog)).toEqual([]);
  });
});
