import { describe, expect, it } from "vitest";
import * as d3 from "d3";
import {
  LABEL_FONT_TIERS,
  MIN_ARC_ANGLE,
  findByKeyPath,
  isArcVisible,
  keyPathOf,
  labelFontSize,
  labelTransform,
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
