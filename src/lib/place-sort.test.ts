import { describe, expect, it } from "vitest";
import { comparePlacesByMentions, placeDepth } from "@/lib/place-sort";

describe("placeDepth", () => {
  it("treats a null namePath as depth 0", () => {
    expect(placeDepth(null)).toBe(0);
  });

  it("treats a single-segment path as depth 0", () => {
    expect(placeDepth("USA/")).toBe(0);
  });

  it("counts nested segments as increasing depth", () => {
    expect(placeDepth("USA/Georgia/")).toBe(1);
    expect(placeDepth("USA/Georgia/Atlanta/")).toBe(2);
  });

  it("ignores a missing trailing slash the same way", () => {
    expect(placeDepth("USA/Georgia/Atlanta")).toBe(2);
  });
});

describe("comparePlacesByMentions", () => {
  it("sorts most-mentioned first", () => {
    const counts = new Map([
      [1, 2],
      [2, 10],
    ]);
    const sorted = [
      { id: 1, name: "A", namePath: "A/" },
      { id: 2, name: "B", namePath: "B/" },
    ].sort(comparePlacesByMentions(counts));
    expect(sorted.map((p) => p.id)).toEqual([2, 1]);
  });

  it("treats missing mention counts as 0", () => {
    const counts = new Map([[1, 5]]);
    const sorted = [
      { id: 2, name: "NoCount", namePath: null },
      { id: 1, name: "HasCount", namePath: null },
    ].sort(comparePlacesByMentions(counts));
    expect(sorted.map((p) => p.id)).toEqual([1, 2]);
  });

  it("puts a shallower place above a tied-mention descendant", () => {
    const counts = new Map([
      [1, 0], // USA
      [2, 0], // USA/Georgia
    ]);
    const sorted = [
      { id: 2, name: "Georgia", namePath: "USA/Georgia/" },
      { id: 1, name: "USA", namePath: "USA/" },
    ].sort(comparePlacesByMentions(counts));
    expect(sorted.map((p) => p.id)).toEqual([1, 2]);
  });

  it("falls back to name as the final tiebreak for genuine siblings", () => {
    const counts = new Map<number, number>();
    const sorted = [
      { id: 2, name: "Zebra", namePath: "Zebra/" },
      { id: 1, name: "Apple", namePath: "Apple/" },
    ].sort(comparePlacesByMentions(counts));
    expect(sorted.map((p) => p.name)).toEqual(["Apple", "Zebra"]);
  });
});
