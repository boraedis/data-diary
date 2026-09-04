import { describe, expect, it } from "vitest";
import {
  computeLabelPlacements,
  computeMovingAverage,
  computeRegionDepths,
  type InteractiveScrollerPoint,
  type LabelCandidate,
  type LineSample,
} from "./interactive-scroller";

// Covers this primitive's non-trivial, easily-isolated pure logic (issue
// #117's deep-dive design pass): the moving average, region depth-stacking,
// and the simplified point-label placement heuristic. Everything else (the
// d3 rendering, the zoom/minimap sync, actual on-screen label/region
// layout) was verified live against real data in the browser instead; see
// the PR for that record.

function pts(values: number[]): InteractiveScrollerPoint[] {
  return values.map((y, i) => ({ x: new Date(2024, 0, i + 1), y }));
}

describe("computeMovingAverage", () => {
  it("returns the raw points unchanged for window <= 1", () => {
    const input = pts([1, 2, 3]);
    expect(computeMovingAverage(input, 1).map((p) => p.y)).toEqual([1, 2, 3]);
    expect(computeMovingAverage(input, 0).map((p) => p.y)).toEqual([1, 2, 3]);
  });

  it("ramps up over a partial window before the window fully fills", () => {
    // window=3: avg(10)=10, avg(10,20)=15, avg(10,20,30)=20
    const input = pts([10, 20, 30]);
    expect(computeMovingAverage(input, 3).map((p) => p.y)).toEqual([10, 15, 20]);
  });

  it("slides a full trailing window once there are enough points", () => {
    // window=2 over [10,20,30,40]: 10, 15, 25, 35
    const input = pts([10, 20, 30, 40]);
    expect(computeMovingAverage(input, 2).map((p) => p.y)).toEqual([10, 15, 25, 35]);
  });

  it("preserves each point's own x", () => {
    const input = pts([1, 2, 3]);
    const result = computeMovingAverage(input, 2);
    expect(result.map((p) => p.x)).toEqual(input.map((p) => p.x));
  });

  it("handles an empty series", () => {
    expect(computeMovingAverage([], 30)).toEqual([]);
  });
});

function region(start: string, end: string, label: string) {
  return { start: new Date(start), end: new Date(end), label };
}

describe("computeRegionDepths", () => {
  it("gives non-overlapping regions the same depth (0)", () => {
    const regions = [region("2020-01-01", "2020-06-01", "A"), region("2020-07-01", "2020-12-01", "B")];
    const result = computeRegionDepths(regions);
    expect(result.map((r) => r.depth)).toEqual([0, 0]);
  });

  it("bumps an overlapping region to the next free depth", () => {
    // B overlaps A entirely (nested), so B needs depth 1.
    const regions = [region("2020-01-01", "2020-12-01", "A"), region("2020-03-01", "2020-06-01", "B")];
    const result = computeRegionDepths(regions);
    expect(result.find((r) => r.label === "A")?.depth).toBe(0);
    expect(result.find((r) => r.label === "B")?.depth).toBe(1);
  });

  it("reuses a freed depth once the earlier region has ended", () => {
    // B overlaps A (depth 1), but C starts after A ends — C can reuse depth 0, not stack to depth 2.
    const regions = [
      region("2020-01-01", "2020-03-01", "A"),
      region("2020-02-01", "2020-02-15", "B"),
      region("2020-04-01", "2020-05-01", "C"),
    ];
    const result = computeRegionDepths(regions);
    expect(result.find((r) => r.label === "A")?.depth).toBe(0);
    expect(result.find((r) => r.label === "B")?.depth).toBe(1);
    expect(result.find((r) => r.label === "C")?.depth).toBe(0);
  });

  it("stacks three mutually-overlapping regions into three distinct depths", () => {
    const regions = [
      region("2020-01-01", "2020-12-01", "A"),
      region("2020-01-01", "2020-12-01", "B"),
      region("2020-01-01", "2020-12-01", "C"),
    ];
    const result = computeRegionDepths(regions);
    expect(new Set(result.map((r) => r.depth))).toEqual(new Set([0, 1, 2]));
  });

  it("handles an empty list", () => {
    expect(computeRegionDepths([])).toEqual([]);
  });
});

function candidate(id: string, pixelX: number, pixelY: number, text: string): LabelCandidate {
  return { id, pixelX, pixelY, text, color: "red" };
}

describe("computeLabelPlacements", () => {
  it("places every label when they're far apart", () => {
    const result = computeLabelPlacements([candidate("a", 0, 100, "A"), candidate("b", 500, 100, "B")], 11);
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("prefers placing a label above its point", () => {
    const result = computeLabelPlacements([candidate("a", 0, 100, "A")], 11);
    expect(result).toEqual([{ id: "a", pixelX: 0, pixelY: 100, text: "A", color: "red", above: true }]);
  });

  it("falls back to below when two nearby labels would collide above", () => {
    // Two points close enough in x that their "above" boxes would overlap —
    // the second-processed (by x order) one should fall back to below
    // rather than being hidden outright.
    const result = computeLabelPlacements([candidate("a", 0, 100, "A"), candidate("b", 5, 100, "B")], 11);
    expect(result).toHaveLength(2);
    const a = result.find((r) => r.id === "a");
    const b = result.find((r) => r.id === "b");
    expect(a?.above).toBe(true);
    expect(b?.above).toBe(false);
  });

  it("hides a label that overlaps in both directions", () => {
    // Three points stacked at the same x, 10px apart — a takes "above", b
    // (blocked above by a) takes "below", leaving c blocked in both
    // directions (a's box above it, b's box below it) and hidden.
    const result = computeLabelPlacements(
      [candidate("a", 0, 90, "AAAAAAAAAA"), candidate("b", 0, 100, "BBBBBBBBBB"), candidate("c", 0, 110, "CCCCCCCCCC")],
      11,
    );
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("handles an empty candidate list", () => {
    expect(computeLabelPlacements([], 11)).toEqual([]);
  });

  function sample(pixelX: number, pixelY: number): LineSample {
    return { pixelX, pixelY };
  }

  it("falls back to below when the line itself passes through the 'above' box", () => {
    // A line sample sitting right where the "above" box would go (just
    // above and within the label's own x-span) should push the label
    // below instead, same as another label would.
    const lineSamples = [sample(0, 85)];
    const result = computeLabelPlacements([candidate("a", 0, 100, "A")], 11, lineSamples);
    expect(result).toEqual([{ id: "a", pixelX: 0, pixelY: 100, text: "A", color: "red", above: false }]);
  });

  it("hides a label whose only two options both cross the line", () => {
    const lineSamples = [sample(0, 85), sample(0, 115)];
    const result = computeLabelPlacements([candidate("a", 0, 100, "A")], 11, lineSamples);
    expect(result).toEqual([]);
  });

  it("ignores a line sample outside the label's own horizontal span", () => {
    // Far enough in x that it can't be under this short label's box.
    const lineSamples = [sample(1000, 85)];
    const result = computeLabelPlacements([candidate("a", 0, 100, "A")], 11, lineSamples);
    expect(result).toEqual([{ id: "a", pixelX: 0, pixelY: 100, text: "A", color: "red", above: true }]);
  });

  it("defaults to no line samples (backward compatible)", () => {
    const result = computeLabelPlacements([candidate("a", 0, 100, "A")], 11);
    expect(result).toHaveLength(1);
  });
});
