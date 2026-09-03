import { describe, expect, it } from "vitest";
import { buildPlaceForest, findMatchingAndAncestorIds, getDescendantIdSet } from "@/lib/place-tree";

type Place = { id: number; name: string; parentId: number | null; namePath: string | null };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const PLACES: Place[] = [
  { id: 1, name: "USA", parentId: null, namePath: "USA/" },
  { id: 2, name: "Georgia", parentId: 1, namePath: "USA/Georgia/" },
  { id: 3, name: "Atlanta", parentId: 2, namePath: "USA/Georgia/Atlanta/" },
  { id: 4, name: "Turkey", parentId: null, namePath: "Turkey/" },
];

describe("buildPlaceForest", () => {
  it("nests places under their parents into a forest of roots", () => {
    const forest = buildPlaceForest(PLACES, byName);
    expect(forest.map((n) => n.place.name)).toEqual(["Turkey", "USA"]);
    const usa = forest.find((n) => n.place.name === "USA")!;
    expect(usa.children.map((n) => n.place.name)).toEqual(["Georgia"]);
    expect(usa.children[0].children.map((n) => n.place.name)).toEqual(["Atlanta"]);
  });

  it("treats a place with a dangling parentId as its own root instead of dropping it", () => {
    const orphan: Place = { id: 99, name: "Orphan", parentId: 12345, namePath: null };
    const forest = buildPlaceForest([...PLACES, orphan], byName);
    expect(forest.map((n) => n.place.name)).toContain("Orphan");
  });

  it("returns an empty forest for an empty input", () => {
    expect(buildPlaceForest([], byName)).toEqual([]);
  });
});

describe("getDescendantIdSet", () => {
  it("returns every descendant id but not the id itself", () => {
    const result = getDescendantIdSet(1, PLACES);
    expect(result).toEqual(new Set([2, 3]));
  });

  it("returns an empty set for a leaf place", () => {
    expect(getDescendantIdSet(3, PLACES)).toEqual(new Set());
  });

  it("does not hang or loop forever on a corrupted parent-id cycle", () => {
    const cyclic: Place[] = [
      { id: 10, name: "A", parentId: 11, namePath: null },
      { id: 11, name: "B", parentId: 10, namePath: null },
    ];
    const result = getDescendantIdSet(10, cyclic);
    expect(result).toEqual(new Set([11]));
  });
});

describe("findMatchingAndAncestorIds", () => {
  type SearchablePlace = Place & { alias: string | null; category: string | null };
  const SEARCHABLE: SearchablePlace[] = PLACES.map((p) => ({ ...p, alias: null, category: null }));

  it("returns null for a blank query", () => {
    expect(findMatchingAndAncestorIds("   ", SEARCHABLE)).toBeNull();
  });

  it("matches case-insensitively by name and returns ancestor ids", () => {
    const result = findMatchingAndAncestorIds("atlanta", SEARCHABLE)!;
    expect(result.matches).toEqual(new Set([3]));
    expect(result.ancestors).toEqual(new Set([1, 2]));
  });

  it("matches by alias or category, not just name", () => {
    const withAlias: SearchablePlace[] = [
      { id: 5, name: "The Big Apple", parentId: null, namePath: null, alias: "NYC", category: null },
    ];
    expect(findMatchingAndAncestorIds("nyc", withAlias)!.matches).toEqual(new Set([5]));
  });

  it("returns no ancestors for a root-level match", () => {
    const result = findMatchingAndAncestorIds("turkey", SEARCHABLE)!;
    expect(result.matches).toEqual(new Set([4]));
    expect(result.ancestors).toEqual(new Set());
  });
});
