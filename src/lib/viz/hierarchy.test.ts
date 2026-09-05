import { describe, expect, it } from "vitest";
import {
  buildTreeFromLevels,
  buildTreeFromParents,
  foldTailIntoOther,
  pruneEmptyBranches,
  sumValues,
  type HierarchyDatum,
} from "./hierarchy";

type Row = { id: number; name: string; parentId: number | null; value: number; category?: string | null };

function row(id: number, name: string, parentId: number | null, value = 0, category?: string | null): Row {
  return { id, name, parentId, value, category };
}

const toNode = (r: Row): HierarchyDatum => ({ key: String(r.id), name: r.name, value: r.value });
const parentKeyOf = (r: Row) => (r.parentId === null ? null : String(r.parentId));

function childNames(node: HierarchyDatum | null): string[] {
  return (node?.children ?? []).map((c) => c.name);
}

describe("sumValues", () => {
  it("adds a node's own value to every descendant's", () => {
    const tree: HierarchyDatum = {
      key: "a",
      name: "A",
      value: 1,
      children: [
        { key: "b", name: "B", value: 2 },
        { key: "c", name: "C", children: [{ key: "d", name: "D", value: 4 }] },
      ],
    };
    expect(sumValues(tree)).toBe(7);
  });

  it("treats a missing value as zero", () => {
    expect(sumValues({ key: "a", name: "A" })).toBe(0);
  });
});

describe("buildTreeFromParents", () => {
  it("nests rows under their parent", () => {
    const tree = buildTreeFromParents([row(1, "USA", null), row(2, "Georgia", 1), row(3, "Atlanta", 2)], {
      rootName: "World",
      toNode,
      parentKeyOf,
    });
    expect(childNames(tree)).toEqual(["USA"]);
    expect(childNames(tree.children?.[0] ?? null)).toEqual(["Georgia"]);
    expect(childNames(tree.children?.[0]?.children?.[0] ?? null)).toEqual(["Atlanta"]);
  });

  it("treats a row whose parent isn't in the set as a root", () => {
    // Atlanta's parent (2) was never fetched — it still has to render
    // somewhere rather than vanishing with its whole subtree.
    const tree = buildTreeFromParents([row(1, "USA", null), row(3, "Atlanta", 2)], {
      rootName: "World",
      toNode,
      parentKeyOf,
    });
    expect(childNames(tree).sort()).toEqual(["Atlanta", "USA"]);
  });

  it("re-roots a self-referencing row instead of looping forever", () => {
    // The exact corruption scripts/split-duplicate-places.mjs exists for.
    const tree = buildTreeFromParents([row(1, "USA", null), row(2, "Broken", 2)], {
      rootName: "World",
      toNode,
      parentKeyOf,
    });
    expect(childNames(tree).sort()).toEqual(["Broken", "USA"]);
  });

  it("re-roots a longer parent cycle", () => {
    const tree = buildTreeFromParents([row(1, "A", 2), row(2, "B", 1)], {
      rootName: "World",
      toNode,
      parentKeyOf,
    });
    expect(childNames(tree).sort()).toEqual(["A", "B"]);
  });

  it("preserves the total value across the rebuild", () => {
    const rows = [row(1, "USA", null, 3), row(2, "Georgia", 1, 5), row(3, "Atlanta", 2, 7)];
    const tree = buildTreeFromParents(rows, { rootName: "World", toNode, parentKeyOf });
    expect(sumValues(tree)).toBe(15);
  });

  it("returns a childless root for no rows", () => {
    const tree = buildTreeFromParents([], { rootName: "World", toNode, parentKeyOf });
    expect(tree.name).toBe("World");
    expect(childNames(tree)).toEqual([]);
  });
});

describe("buildTreeFromLevels", () => {
  const leaves = [
    row(1, "Cafe A", null, 2, "Restaurant"),
    row(2, "Cafe B", null, 3, "Restaurant"),
    row(3, "Gym", null, 4, "Recreation"),
    row(4, "Mystery", null, 1, null),
  ];

  const tree = buildTreeFromLevels(leaves, {
    rootName: "All",
    levels: [{ of: (r: Row) => r.category, fallback: "Uncategorized" }],
    toLeaf: toNode,
  });

  it("groups rows under one node per level value", () => {
    expect(childNames(tree).sort()).toEqual(["Recreation", "Restaurant", "Uncategorized"]);
  });

  it("puts a null level value under the fallback rather than dropping the row", () => {
    const uncategorized = tree.children?.find((c) => c.name === "Uncategorized");
    expect(childNames(uncategorized ?? null)).toEqual(["Mystery"]);
  });

  it("leaves grouping nodes with no value of their own", () => {
    expect(tree.children?.every((c) => c.value === undefined)).toBe(true);
    expect(sumValues(tree)).toBe(10);
  });

  it("keeps same-named sub-levels under different parents separate", () => {
    const nested = buildTreeFromLevels(
      [
        { top: "Restaurant", sub: "Other", id: 1 },
        { top: "Recreation", sub: "Other", id: 2 },
      ],
      {
        rootName: "All",
        levels: [
          { of: (r: { top: string }) => r.top, fallback: "?" },
          { of: (r: { sub: string }) => r.sub, fallback: "?" },
        ],
        toLeaf: (r) => ({ key: String(r.id), name: `place-${r.id}`, value: 1 }),
      },
    );
    expect(nested.children).toHaveLength(2);
    for (const branch of nested.children ?? []) {
      expect(childNames(branch)).toEqual(["Other"]);
    }
  });
});

describe("pruneEmptyBranches", () => {
  it("drops a subtree that sums to zero", () => {
    const tree: HierarchyDatum = {
      key: "root",
      name: "Root",
      children: [
        { key: "a", name: "A", value: 5 },
        { key: "b", name: "B", children: [{ key: "c", name: "C", value: 0 }] },
      ],
    };
    expect(childNames(pruneEmptyBranches(tree))).toEqual(["A"]);
  });

  it("keeps an ancestor with no value of its own but a non-empty descendant", () => {
    const tree: HierarchyDatum = {
      key: "root",
      name: "Root",
      children: [{ key: "usa", name: "USA", children: [{ key: "atl", name: "Atlanta", value: 3 }] }],
    };
    const pruned = pruneEmptyBranches(tree);
    expect(childNames(pruned)).toEqual(["USA"]);
    expect(childNames(pruned?.children?.[0] ?? null)).toEqual(["Atlanta"]);
  });

  it("returns null when nothing in the tree has a value", () => {
    expect(pruneEmptyBranches({ key: "root", name: "Root", children: [{ key: "a", name: "A" }] })).toBeNull();
  });

  it("drops the children key entirely on a leaf, rather than leaving an empty array", () => {
    // d3.hierarchy treats `children: []` as an internal node with no
    // children, not a leaf — which would make it non-clickable *and*
    // paint it with the internal-node treatment.
    const pruned = pruneEmptyBranches({ key: "a", name: "A", value: 1, children: [{ key: "b", name: "B" }] });
    expect(pruned?.children).toBeUndefined();
  });
});

describe("foldTailIntoOther", () => {
  const wide: HierarchyDatum = {
    key: "root",
    name: "Root",
    children: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, name: `N${i}`, value: 10 - i })),
  };

  it("keeps the largest `keep` children and groups the rest", () => {
    const folded = foldTailIntoOther(wide, { keep: 3 });
    expect(childNames(folded)).toEqual(["N0", "N1", "N2", "Other"]);
  });

  it("keeps the tail drillable inside Other rather than discarding it", () => {
    const folded = foldTailIntoOther(wide, { keep: 3 });
    const other = folded.children?.at(-1);
    expect(childNames(other ?? null)).toEqual(["N3", "N4", "N5", "N6", "N7", "N8"]);
  });

  it("conserves the total", () => {
    expect(sumValues(foldTailIntoOther(wide, { keep: 3 }))).toBe(sumValues(wide));
  });

  it("leaves the node alone when folding would gain nothing", () => {
    // 6 children with keep: 5 would put exactly one child under "Other",
    // which is strictly worse than just showing it.
    const six: HierarchyDatum = {
      key: "root",
      name: "Root",
      children: Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, name: `N${i}`, value: 1 })),
    };
    expect(foldTailIntoOther(six, { keep: 5 })).toBe(six);
  });

  it("ranks by subtree total, not by the child's own value", () => {
    const tree: HierarchyDatum = {
      key: "root",
      name: "Root",
      children: [
        { key: "big", name: "Big", children: [{ key: "b1", name: "b1", value: 100 }] },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `s${i}`, name: `S${i}`, value: 5 })),
      ],
    };
    expect(childNames(foldTailIntoOther(tree, { keep: 1 }))).toEqual(["Big", "Other"]);
  });
});
