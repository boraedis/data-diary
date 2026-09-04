import { describe, expect, it } from "vitest";
import { computeMovingAverage, type InteractiveScrollerPoint } from "./interactive-scroller";

// Covers computeMovingAverage's own logic (issue #117) — the one piece of
// non-trivial, easily-isolated math in this primitive. Everything else
// (the d3 rendering, the zoom/minimap sync) was verified live against real
// weight data in the browser instead, per this issue's own acceptance
// criteria; see the PR for that record.

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
