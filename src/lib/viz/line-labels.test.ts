import { describe, expect, it } from "vitest";
import {
  placePointLabels,
  pointPriorities,
  pointsSparseEnough,
  preferredSide,
  segmentIntersectsBox,
  spreadEndLabels,
  type PointLabelCandidate,
} from "@/lib/viz/line-labels";

const BOUNDS = { x0: 0, y0: 0, x1: 400, y1: 200 };

function candidate(overrides: Partial<PointLabelCandidate> & { key: string; x: number; y: number }): PointLabelCandidate {
  return { seriesIndex: 0, radius: 4, width: 30, height: 14, priority: 0, prefer: "above", ...overrides };
}

describe("segmentIntersectsBox", () => {
  const box = { x0: 10, y0: 10, x1: 20, y1: 20 };
  it("finds a segment passing through", () => {
    expect(segmentIntersectsBox({ x: 0, y: 15 }, { x: 30, y: 15 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: 0, y: 0 }, { x: 30, y: 30 }, box)).toBe(true);
  });
  it("finds a segment ending inside", () => {
    expect(segmentIntersectsBox({ x: 0, y: 0 }, { x: 15, y: 15 }, box)).toBe(true);
  });
  it("misses a segment passing by", () => {
    expect(segmentIntersectsBox({ x: 0, y: 25 }, { x: 30, y: 25 }, box)).toBe(false);
    expect(segmentIntersectsBox({ x: 0, y: 0 }, { x: 30, y: 5 }, box)).toBe(false);
  });
});

describe("spreadEndLabels", () => {
  it("leaves labels that already clear each other where they are", () => {
    expect(spreadEndLabels([20, 80, 50], { height: 14, min: 0, max: 200 })).toEqual([20, 80, 50]);
  });
  it("pushes overlapping labels apart, keeping their order", () => {
    const ys = spreadEndLabels([100, 102], { height: 14, min: 0, max: 200 });
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(14);
    expect(ys[0]).toBe(100);
  });
  it("pulls a stack back up from the bottom bound", () => {
    const ys = spreadEndLabels([195, 196, 197], { height: 14, min: 0, max: 200 });
    expect(Math.max(...ys)).toBeLessThanOrEqual(193);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(14);
    expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(14);
  });
  it("returns placements in input order", () => {
    const ys = spreadEndLabels([150, 10], { height: 14, min: 0, max: 200 });
    expect(ys).toEqual([150, 10]);
  });
});

describe("preferredSide", () => {
  it("puts a peak's label above and a trough's below", () => {
    // Pixel y: smaller is higher.
    expect(preferredSide([100, 50, 100], 1)).toBe("above");
    expect(preferredSide([50, 100, 50], 1)).toBe("below");
  });
  it("judges an end point against its one neighbour", () => {
    expect(preferredSide([50, 100], 0)).toBe("above");
    expect(preferredSide([50, 100], 1)).toBe("below");
  });
});

describe("pointPriorities", () => {
  it("ranks last, then highest, then lowest, then earliest", () => {
    const p = pointPriorities([5, 9, 1, 4, 6]);
    const order = p.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).map((e) => e.i);
    expect(order).toEqual([4, 1, 2, 0, 3]);
  });
});

describe("pointsSparseEnough", () => {
  it("needs every gap to clear the wider neighbouring label", () => {
    expect(pointsSparseEnough([0, 50, 100], [30, 30, 30])).toBe(true);
    expect(pointsSparseEnough([0, 30, 100], [30, 30, 30])).toBe(false);
  });
});

describe("placePointLabels", () => {
  it("places a label on its preferred side when it's clear", () => {
    const [placed] = placePointLabels([candidate({ key: "a", x: 100, y: 100 })], {
      bounds: BOUNDS,
      lines: [],
      markers: [],
    });
    expect(placed.side).toBe("above");
    expect(placed.y).toBeLessThan(100);
  });

  it("falls back to the other side when the preferred one crosses a line", () => {
    const line = [
      { x: 0, y: 90 },
      { x: 400, y: 90 },
    ];
    const [placed] = placePointLabels([candidate({ key: "a", x: 100, y: 100 })], {
      bounds: BOUNDS,
      lines: [line],
      markers: [],
    });
    expect(placed.side).toBe("below");
  });

  it("drops a label with no clean side", () => {
    const above = [
      { x: 0, y: 90 },
      { x: 400, y: 90 },
    ];
    const below = [
      { x: 0, y: 110 },
      { x: 400, y: 110 },
    ];
    expect(placePointLabels([candidate({ key: "a", x: 100, y: 100 })], { bounds: BOUNDS, lines: [above, below], markers: [] })).toEqual([]);
  });

  it("lets the higher-priority of two colliding labels win", () => {
    const placed = placePointLabels(
      [candidate({ key: "low", x: 100, y: 100, priority: 1 }), candidate({ key: "high", x: 110, y: 100, priority: 2, prefer: "above" })],
      { bounds: BOUNDS, lines: [], markers: [] },
    );
    // "low" can't go above (taken) but can go below.
    expect(placed.map((p) => p.key)).toEqual(["high", "low"]);
    expect(placed[1].side).toBe("below");
  });

  it("avoids another series' marker", () => {
    const [placed] = placePointLabels([candidate({ key: "a", x: 100, y: 100 })], {
      bounds: BOUNDS,
      lines: [],
      markers: [{ x0: 96, y0: 80, x1: 104, y1: 88 }],
    });
    expect(placed.side).toBe("below");
  });

  it("slides an edge label sideways into the plot, never off its point vertically", () => {
    const [placed] = placePointLabels([candidate({ key: "a", x: 398, y: 100 })], {
      bounds: BOUNDS,
      lines: [],
      markers: [],
    });
    expect(placed.x + 15).toBeLessThanOrEqual(400);
  });

  it("drops a label that would leave the plot vertically on both sides", () => {
    expect(
      placePointLabels([candidate({ key: "a", x: 100, y: 10, height: 200 })], { bounds: BOUNDS, lines: [], markers: [] }),
    ).toEqual([]);
  });
});
