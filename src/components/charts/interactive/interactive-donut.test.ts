import { describe, expect, it } from "vitest";
import * as d3 from "d3";
import {
  LABEL_FONT_TIERS,
  MIN_ARC_ANGLE,
  defaultColorOf,
  depthFill,
  findByKeyPath,
  isArcInPlay,
  isArcVisible,
  keyPathOf,
  labelFontSize,
  labelTransform,
  pathIsExcluded,
  resolveLabel,
  splitIntoTwoLines,
  transitionArcBoxes,
  type ArcBox,
} from "./interactive-donut";
import type { HierarchyDatum } from "@/lib/viz/hierarchy";

// Covers this primitive's pure, isolable logic: the ring-visibility
// window, the label fit/tier heuristic, the polar label transform, and the
// key-path addressing the zoom state is remembered with. The d3 rendering
// itself (arc tween, hover wiring, breadcrumb-driven zoom) is not unit
// tested — see the PR for what was and wasn't verified live.

const TAU = 2 * Math.PI;

function box(x0: number, x1: number, y0: number, y1: number): ArcBox {
  return { x0, x1, y0, y1 };
}

describe("isArcVisible", () => {
  it("shows a full first ring", () => {
    expect(isArcVisible(box(0, TAU, 1, 2), 2)).toBe(true);
  });

  it("hides the focused node itself (y0 below the first ring)", () => {
    expect(isArcVisible(box(0, TAU, 0, 1), 2)).toBe(false);
  });

  it("hides a ring beyond the visible window", () => {
    expect(isArcVisible(box(0, TAU, 3, 4), 2)).toBe(false);
    expect(isArcVisible(box(0, TAU, 3, 4), 3)).toBe(true);
  });

  it("counts rings as bands drawn around the center", () => {
    // visibleRings: 1 is a plain single-ring donut — exactly one band.
    expect(isArcVisible(box(0, TAU, 1, 2), 1)).toBe(true);
    expect(isArcVisible(box(0, TAU, 2, 3), 1)).toBe(false);
  });

  it("hides a hairline arc even inside the window", () => {
    expect(isArcVisible(box(0, MIN_ARC_ANGLE, 1, 2), 2)).toBe(false);
    expect(isArcVisible(box(0, MIN_ARC_ANGLE * 10, 1, 2), 2)).toBe(true);
  });
});

describe("isArcInPlay", () => {
  const still = (b: ArcBox) => isArcInPlay(b, b, 2);

  it("mounts what the visible window covers", () => {
    expect(still(box(0, TAU, 1, 2))).toBe(true);
    expect(still(box(0, TAU, 2, 3))).toBe(true);
  });

  it("leaves out a ring beyond the window", () => {
    expect(still(box(0, TAU, 3, 4))).toBe(false);
  });

  it("leaves out the focused node itself and its ancestors", () => {
    // The focus occupies y 0-1 — that's the center disc, drawn by React.
    expect(still(box(0, TAU, 0, 1))).toBe(false);
  });

  it("mounts a node that is only visible at the far end of a zoom", () => {
    // Currently three rings out, heading for the first ring: it has to
    // exist before the transition starts so it can animate inward.
    const current = box(0, 0.5, 3, 4);
    const target = box(0, TAU, 1, 2);
    expect(isArcInPlay(current, target, 2)).toBe(true);
    expect(isArcVisible(current, 2)).toBe(false);
  });

  it("mounts a node that only sweeps through the window mid-flight", () => {
    // A multi-level breadcrumb jump: outside the window at both ends, but
    // it crosses the visible rings on the way, so the reader sees it move.
    expect(isArcInPlay(box(0, TAU, 4, 5), box(0, TAU, 0, 1), 2)).toBe(true);
  });

  it("leaves out a hairline that is a hairline in both frames", () => {
    const hair = box(0, MIN_ARC_ANGLE, 1, 2);
    expect(isArcInPlay(hair, hair, 2)).toBe(false);
    // ...but keeps it if the zoom is about to open it up.
    expect(isArcInPlay(hair, box(0, TAU, 1, 2), 2)).toBe(true);
  });

  it("never drops an arc that isArcVisible would draw", () => {
    for (const y of [1, 2, 3, 4]) {
      for (const width of [0.0005, 0.01, 1, TAU]) {
        const b = box(0, width, y, y + 1);
        if (isArcVisible(b, 2)) expect(isArcInPlay(b, b, 2)).toBe(true);
      }
    }
  });
});

describe("labelFontSize", () => {
  const radius = 120;

  it("gives a large arc the biggest tier", () => {
    // A whole-ring arc: no tangential constraint, and 120px of radial run.
    expect(labelFontSize(box(0, TAU, 1, 2), radius, 6)).toBe(LABEL_FONT_TIERS[0]);
  });

  it("steps down a tier when the name is too long for the ring's thickness", () => {
    const short = labelFontSize(box(0, TAU, 1, 2), radius, 6);
    const long = labelFontSize(box(0, TAU, 1, 2), radius, 16);
    expect(short).toBe(15);
    expect(long).toBe(12);
  });

  it("hides the label when even the smallest tier can't fit radially", () => {
    expect(labelFontSize(box(0, TAU, 1, 2), radius, 200)).toBeNull();
  });

  it("hides the label when the arc is too thin tangentially", () => {
    // A sliver 0.005 rad wide at mid-radius 1.5 * 120 = ~0.9px of height.
    expect(labelFontSize(box(0, 0.005, 1, 2), radius, 3)).toBeNull();
  });

  it("returns null for an empty name or a zero radius", () => {
    expect(labelFontSize(box(0, TAU, 1, 2), radius, 0)).toBeNull();
    expect(labelFontSize(box(0, TAU, 1, 2), 0, 5)).toBeNull();
  });

  it("never returns a size outside the declared tiers", () => {
    for (const length of [1, 4, 8, 12, 20, 40]) {
      const size = labelFontSize(box(0, TAU / 4, 1, 2), radius, length);
      if (size !== null) expect(LABEL_FONT_TIERS).toContain(size);
    }
  });
});

describe("splitIntoTwoLines", () => {
  it("splits at the space nearest the middle", () => {
    expect(splitIntoTwoLines("Kennesaw Mountain Park")).toEqual(["Kennesaw", "Mountain Park"]);
    expect(splitIntoTwoLines("Bailey's Crossroads")).toEqual(["Bailey's", "Crossroads"]);
  });

  it("refuses a single word rather than hyphenating it", () => {
    expect(splitIntoTwoLines("Fayetteville")).toBeNull();
  });

  it("refuses a split that would leave a blank line", () => {
    expect(splitIntoTwoLines(" Atlanta")).toBeNull();
    expect(splitIntoTwoLines("Atlanta ")).toBeNull();
  });
});

describe("resolveLabel", () => {
  const radius = 120;
  // A wide, thin arc: plenty of room across the arc, not much along the
  // radius — exactly where wrapping pays off.
  const wide = box(0, TAU / 2, 1, 1.75);

  it("uses the full name on one line whenever it fits", () => {
    expect(resolveLabel(box(0, TAU, 1, 2), radius, "Atlanta")).toEqual({ lines: ["Atlanta"], size: 15 });
  });

  it("wraps to two lines rather than shrinking or giving up", () => {
    const resolved = resolveLabel(wide, radius, "Kennesaw Mountain Park");
    expect(resolved?.lines).toEqual(["Kennesaw", "Mountain Park"]);
  });

  it("prefers the full name over a short name, even at a smaller size", () => {
    // An abbreviation the reader has to decode is a worse trade than
    // smaller type, so the alias is a last resort, not a first choice.
    const resolved = resolveLabel(wide, radius, "Kennesaw Mountain Park", "KMP");
    expect(resolved?.lines.join(" ")).toBe("Kennesaw Mountain Park");
  });

  it("falls back to the short name when the full name can't fit at all", () => {
    const cramped = box(0, TAU / 3, 1, 1.35);
    const withoutAlias = resolveLabel(cramped, radius, "Historic Fourth Ward Skatepark");
    const withAlias = resolveLabel(cramped, radius, "Historic Fourth Ward Skatepark", "H4W Skate");
    expect(withoutAlias).toBeNull();
    // The alias gets the same treatment as any other candidate — here it
    // only fits once it wraps, which is fine; what matters is that a label
    // appears at all where there previously was none.
    expect(withAlias?.lines.join(" ")).toBe("H4W Skate");
  });

  it("prefers one line on a tie", () => {
    // "New York" fits either way at the top tier; a wrap the arc didn't
    // need is just two short lines where one would do.
    expect(resolveLabel(box(0, TAU, 1, 2), radius, "New York")?.lines).toHaveLength(1);
  });

  it("still hides a label when neither the name nor the short name fits", () => {
    const sliver = box(0, 0.004, 1, 2);
    expect(resolveLabel(sliver, radius, "Anywhere", "AW")).toBeNull();
  });

  it("ignores a short name identical to the name", () => {
    const sliver = box(0, 0.004, 1, 2);
    expect(resolveLabel(sliver, radius, "Same", "Same")).toBeNull();
  });
});

describe("depthFill", () => {
  it("leaves the innermost visible ring at full strength", () => {
    expect(depthFill("var(--chart-1)", 0)).toBe("var(--chart-1)");
  });

  it("mixes progressively more white going outward", () => {
    expect(depthFill("var(--chart-1)", 1)).toBe("color-mix(in oklch, var(--chart-1), white 10%)");
    expect(depthFill("var(--chart-1)", 2)).toBe("color-mix(in oklch, var(--chart-1), white 19%)");
  });

  it("caps the tint rather than fading a deep ring out entirely", () => {
    // The old fill-opacity ramp bottomed out at 0.35, which against a dark
    // card is most of the color gone. This tops out at a third white.
    expect(depthFill("#3b7dd8", 4)).toBe(depthFill("#3b7dd8", 99));
    expect(depthFill("#3b7dd8", 99)).toBe("color-mix(in oklch, #3b7dd8, white 32%)");
  });

  it("passes a raw hex through the same way as a token", () => {
    expect(depthFill("#3b7dd8", 1)).toBe("color-mix(in oklch, #3b7dd8, white 10%)");
  });
});

describe("defaultColorOf", () => {
  function treeWithBranches(count: number): HierarchyDatum {
    return {
      key: "root",
      name: "Root",
      children: Array.from({ length: count }, (_, i) => ({ key: `b${i}`, name: `Branch ${i}`, value: 1 })),
    };
  }

  it("assigns the first five branches distinct slots in rank order", () => {
    const root = d3.hierarchy(treeWithBranches(5)).sum((d) => d.value ?? 0);
    const colors = root.children!.map((c) => defaultColorOf(c));
    expect(colors).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]);
  });

  it("wraps the 6th+ branch back to the fixed slots rather than a muted overflow color", () => {
    const root = d3.hierarchy(treeWithBranches(8)).sum((d) => d.value ?? 0);
    const colors = root.children!.map((c) => defaultColorOf(c));
    expect(colors[5]).toBe(colors[0]); // rank 5 -> slot 0 again
    expect(colors[6]).toBe(colors[1]); // rank 6 -> slot 1 again
    expect(colors[7]).toBe(colors[2]);
    expect(colors.every((c) => c !== "var(--muted-foreground)")).toBe(true);
  });

  it("still prefers a branch's own author-assigned color over any slot", () => {
    const tree: HierarchyDatum = {
      key: "root",
      name: "Root",
      children: [
        { key: "a", name: "A", value: 1, color: "#abcdef" },
        { key: "b", name: "B", value: 1 },
      ],
    };
    const root = d3.hierarchy(tree).sum((d) => d.value ?? 0);
    expect(defaultColorOf(root.children![0])).toBe("#abcdef");
    expect(defaultColorOf(root.children![1])).toBe("var(--chart-2)");
  });
});

describe("labelTransform", () => {
  it("puts an arc centered at 3 o'clock upright at mid-radius", () => {
    // Mid-angle π/2 (d3 measures clockwise from 12 o'clock) -> rotate(0).
    expect(labelTransform(box(Math.PI / 2, Math.PI / 2, 1, 3), 100)).toBe("rotate(0) translate(200,0) rotate(0)");
  });

  it("flips a label on the left half so it reads upright", () => {
    // Mid-angle 3π/2 (9 o'clock) is past 180 degrees -> second rotate(180).
    expect(labelTransform(box((3 * Math.PI) / 2, (3 * Math.PI) / 2, 1, 3), 100)).toBe(
      "rotate(180) translate(200,0) rotate(180)",
    );
  });
});

describe("keyPathOf / findByKeyPath", () => {
  const data: HierarchyDatum = {
    key: "root",
    name: "World",
    children: [
      {
        key: "usa",
        name: "USA",
        children: [
          { key: "ga", name: "Georgia", value: 3 },
          { key: "ny", name: "New York", value: 5 },
        ],
      },
      { key: "fr", name: "France", value: 2 },
    ],
  };
  const root = d3.hierarchy(data).sum((d) => d.value ?? 0);

  it("addresses the root as the empty path", () => {
    expect(keyPathOf(root)).toEqual([]);
    expect(findByKeyPath(root, [])).toBe(root);
  });

  it("round-trips every node through its key path", () => {
    for (const node of root.descendants()) {
      expect(findByKeyPath(root, keyPathOf(node))).toBe(node);
    }
  });

  it("excludes the root's own key from the path", () => {
    const georgia = root.descendants().find((n) => n.data.key === "ga");
    expect(keyPathOf(georgia!)).toEqual(["usa", "ga"]);
  });

  it("returns null for a path that no longer resolves", () => {
    // What happens when the remembered focus points into data that has
    // since changed — the caller falls back to the root.
    expect(findByKeyPath(root, ["usa", "gone"])).toBeNull();
    expect(findByKeyPath(root, ["nope"])).toBeNull();
  });

  it("returns null rather than descending past a leaf", () => {
    expect(findByKeyPath(root, ["fr", "anything"])).toBeNull();
  });
});

describe("pathIsExcluded", () => {
  it("is false for a path with no prefix in the id set", () => {
    expect(pathIsExcluded(["usa", "ga"], new Set(["fr"]))).toBe(false);
  });

  it("is true when the exact path is excluded", () => {
    expect(pathIsExcluded(["usa", "ga"], new Set(["usa\u0000ga"]))).toBe(true);
  });

  it("is true when an ancestor is excluded, not just the exact node", () => {
    expect(pathIsExcluded(["usa", "ga", "atl"], new Set(["usa\u0000ga"]))).toBe(true);
  });

  it("never treats the root (empty path) as excluded", () => {
    expect(pathIsExcluded([], new Set(["usa\u0000ga"]))).toBe(false);
  });
});

describe("transitionArcBoxes", () => {
  // A before Excl before C in the sorted order `layout` would establish —
  // biggest first. Excl sits between two siblings whose own values never
  // change, which is exactly the shape that exercises "does a neighbor on
  // *either* side organically grow."
  const TREE: HierarchyDatum = {
    key: "root",
    name: "Root",
    children: [
      { key: "a", name: "A", value: 20 },
      {
        key: "excl",
        name: "Excl",
        children: [
          { key: "e1", name: "E1", value: 6 },
          { key: "e2", name: "E2", value: 4 },
        ],
      },
      { key: "c", name: "C", value: 8 },
    ],
  };
  const root = d3.hierarchy(TREE);
  const notExcluded = () => false;
  const exclExcluded = (path: string[]) => pathIsExcluded(path, new Set(["excl"]));

  it("at t=0 (nothing excluded), matches a plain partition", () => {
    const boxes = transitionArcBoxes(root, notExcluded, notExcluded, 0);
    // Full circle split 20:10:8 among the three top-level branches.
    expect(boxes.get("a")).toEqual({ x0: 0, x1: (20 / 38) * 2 * Math.PI, y0: 1, y1: 2 });
    const excl = boxes.get("excl")!;
    expect(excl.x0).toBeCloseTo((20 / 38) * 2 * Math.PI, 10);
    expect(excl.x1 - excl.x0).toBeCloseTo((10 / 38) * 2 * Math.PI, 10);
  });

  it("at t=1 with excl excluded, collapses it and its descendants to zero width", () => {
    const boxes = transitionArcBoxes(root, notExcluded, exclExcluded, 1);
    const excl = boxes.get("excl")!;
    expect(excl.x1 - excl.x0).toBeCloseTo(0, 10);
    // Every descendant collapses too, to the exact same point — not each
    // to its own separate angle.
    const e1 = boxes.get("excl\u0000e1")!;
    const e2 = boxes.get("excl\u0000e2")!;
    expect(e1.x0).toBeCloseTo(excl.x0, 10);
    expect(e1.x1).toBeCloseTo(excl.x0, 10);
    expect(e2.x0).toBeCloseTo(excl.x0, 10);
  });

  it("lets both neighbors grow to exactly absorb the freed space — gapless", () => {
    const before = transitionArcBoxes(root, notExcluded, notExcluded, 0);
    const after = transitionArcBoxes(root, notExcluded, exclExcluded, 1);

    const aBefore = before.get("a")!;
    const aAfter = after.get("a")!;
    const cBefore = before.get("c")!;
    const cAfter = after.get("c")!;

    expect(aAfter.x1).toBeGreaterThan(aBefore.x1);
    expect(cAfter.x1 - cAfter.x0).toBeGreaterThan(cBefore.x1 - cBefore.x0);
    // A's new end and C's new start meet exactly where excl collapsed to
    // — nothing left over, nothing overlapping.
    expect(cAfter.x0).toBeCloseTo(aAfter.x1, 10);
    expect(after.get("excl")!.x0).toBeCloseTo(aAfter.x1, 10);
    // The whole span is still fully accounted for.
    expect(cAfter.x1).toBeCloseTo(2 * Math.PI, 10);
  });

  it("interpolates a mid-transition frame strictly between the two endpoints", () => {
    const start = transitionArcBoxes(root, notExcluded, exclExcluded, 0).get("excl")!;
    const mid = transitionArcBoxes(root, notExcluded, exclExcluded, 0.5).get("excl")!;
    const end = transitionArcBoxes(root, notExcluded, exclExcluded, 1).get("excl")!;

    const startWidth = start.x1 - start.x0;
    const midWidth = mid.x1 - mid.x0;
    const endWidth = end.x1 - end.x0;
    expect(midWidth).toBeLessThan(startWidth);
    expect(midWidth).toBeGreaterThan(endWidth);
  });

  it("preserves sibling order even as a value shrinks toward zero", () => {
    // A is always before Excl is always before C, at every t — nothing
    // reorders mid-transition just because a value crossed another's.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const boxes = transitionArcBoxes(root, notExcluded, exclExcluded, t);
      const a = boxes.get("a")!;
      const excl = boxes.get("excl")!;
      const c = boxes.get("c")!;
      expect(a.x0).toBeLessThanOrEqual(a.x1 + 1e-9);
      expect(a.x1).toBeCloseTo(excl.x0, 10);
      expect(excl.x1).toBeCloseTo(c.x0, 10);
    }
  });
});
