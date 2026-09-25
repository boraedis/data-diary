import { describe, expect, it } from "vitest";
import { binSeries } from "@/lib/viz/hist";

describe("binSeries", () => {
  it("counts every series against the same edges", () => {
    const { buckets, totals } = binSeries(
      [
        { id: "a", values: [0, 1, 1, 2] },
        { id: "b", values: [2, 2, 3] },
      ],
      { domain: [0, 4], thresholds: [0, 1, 2, 3, 4] },
    );
    expect(buckets.map((b) => [b.x0, b.x1])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(buckets.map((b) => b.counts)).toEqual([
      { a: 1, b: 0 },
      { a: 2, b: 0 },
      { a: 1, b: 2 },
      { a: 0, b: 1 },
    ]);
    expect(totals).toEqual({ a: 4, b: 3 });
  });

  it("puts a value equal to the top edge in the last bucket, like d3.bin", () => {
    const { buckets } = binSeries([{ id: "a", values: [4] }], { domain: [0, 4], thresholds: [0, 2, 4] });
    expect(buckets.map((b) => b.counts.a)).toEqual([0, 1]);
  });

  it("drops values outside the domain from both counts and totals", () => {
    const { buckets, totals } = binSeries([{ id: "a", values: [-1, 1, 9] }], { domain: [0, 2], thresholds: [0, 1, 2] });
    expect(buckets.map((b) => b.counts.a)).toEqual([0, 1]);
    expect(totals.a).toBe(1);
  });

  it("gives an empty series explicit zeros rather than missing keys", () => {
    const { buckets, totals } = binSeries(
      [
        { id: "a", values: [1] },
        { id: "b", values: [] },
      ],
      { domain: [0, 2], thresholds: [0, 1, 2] },
    );
    expect(buckets.every((b) => b.counts.b === 0)).toBe(true);
    expect(totals.b).toBe(0);
  });

  it("uses one shared set of auto edges when no thresholds are given", () => {
    const { buckets, totals } = binSeries([
      { id: "a", values: [1, 2, 3] },
      { id: "b", values: [50, 60] },
    ]);
    expect(buckets[0].x0).toBeLessThanOrEqual(1);
    expect(buckets[buckets.length - 1].x1).toBeGreaterThanOrEqual(60);
    expect(totals).toEqual({ a: 3, b: 2 });
  });

  it("returns no buckets for no values", () => {
    expect(binSeries([{ id: "a", values: [] }]).buckets).toEqual([]);
  });
});
