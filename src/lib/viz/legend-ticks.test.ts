import { describe, expect, it } from "vitest";
import { legendTicks } from "./legend-ticks";

const values = (ticks: ReturnType<typeof legendTicks>) => ticks?.map((t) => t.value);

describe("legendTicks", () => {
  it("picks rounded values inside a linear domain, never widening it", () => {
    expect(values(legendTicks([1.3, 9.7]))).toEqual([2, 4, 6, 8]);
  });

  it("positions linear ticks as a plain fraction across the domain", () => {
    const ticks = legendTicks([0, 10])!;
    expect(ticks[0]).toEqual({ value: 0, t: 0 });
    expect(ticks.at(-1)).toEqual({ value: 10, t: 1 });
  });

  it("rounds in the display unit rather than the stored one", () => {
    // Sleep minutes, read as hours.
    expect(values(legendTicks([320, 640], { unit: 60 }))).toEqual([360, 420, 480, 540, 600]);
  });

  it("uses powers of ten on a log domain spanning several decades", () => {
    const ticks = legendTicks([2, 3000], { scale: "log" })!;
    expect(values(ticks)).toEqual([10, 100, 1000]);
    expect(ticks[1].t).toBeCloseTo(Math.log(100 / 2) / Math.log(3000 / 2));
  });

  it("adds 2x and 5x steps on a narrow log domain", () => {
    expect(values(legendTicks([1, 30], { scale: "log" }))).toEqual([1, 2, 5, 10, 20]);
  });

  it("returns null when nothing useful fits", () => {
    expect(legendTicks([5, 5])).toBeNull();
    expect(legendTicks([0, 10], { scale: "log" })).toBeNull();
    expect(legendTicks([3.2, 3.8], { count: 1 })).toBeNull(); // only 3.5 fits
  });
});
