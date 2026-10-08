import { describe, expect, it } from "vitest";
import { padDomain } from "@/lib/viz/domain";

describe("padDomain", () => {
  it("never extends below zero when every value is non-negative", () => {
    // Screen time: 0.5h–6h would have padded down to −0.05h.
    expect(padDomain([0.5, 3, 6])).toEqual([0, 6.55]);
    expect(padDomain([0, 4])).toEqual([0, 4.4]);
  });

  it("floors rather than pins — a series far above zero keeps its fit", () => {
    expect(padDomain([160, 190])).toEqual([157, 193]);
  });

  it("pads both sides when the data itself goes negative", () => {
    expect(padDomain([-2, 8])).toEqual([-3, 9]);
  });

  it("pads a flat series by one unit, still floored", () => {
    expect(padDomain([0, 0])).toEqual([0, 1]);
    expect(padDomain([5, 5])).toEqual([4, 6]);
  });

  it("falls back to [0, 1] with nothing to fit", () => {
    expect(padDomain([])).toEqual([0, 1]);
    expect(padDomain([NaN])).toEqual([0, 1]);
  });

  it("honours a custom headroom fraction", () => {
    expect(padDomain([10, 20], 0.05)).toEqual([9.5, 20.5]);
  });
});
