import { describe, expect, it } from "vitest";
import { summarize, tCritical95 } from "@/lib/viz/stats";

describe("summarize", () => {
  it("returns null for no values", () => {
    expect(summarize([])).toBeNull();
  });

  it("collapses the interval to the mean for a single value", () => {
    expect(summarize([80])).toEqual({ n: 1, mean: 80, sd: 0, ciLow: 80, ciHigh: 80 });
  });

  it("uses the sample sd and a t-based interval", () => {
    // mean 5, sample sd = sqrt(10/4) ≈ 1.5811, se ≈ 0.7071, t(4) = 2.776
    const s = summarize([3, 4, 5, 6, 7]);
    expect(s?.mean).toBe(5);
    expect(s?.sd).toBeCloseTo(1.5811, 4);
    expect(s?.ciLow).toBeCloseTo(5 - 2.776 * 0.70711, 3);
    expect(s?.ciHigh).toBeCloseTo(5 + 2.776 * 0.70711, 3);
  });
});

describe("tCritical95", () => {
  it("falls back to the normal 1.96 past 30 degrees of freedom", () => {
    expect(tCritical95(30)).toBe(2.042);
    expect(tCritical95(31)).toBe(1.96);
  });
});
