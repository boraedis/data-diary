import { describe, expect, it } from "vitest";
import { AREA_OTHER_ID, capAreaCategories } from "@/lib/viz/area-fold";

const cats = (...ids: string[]) => ids.map((id) => ({ id }));

describe("capAreaCategories", () => {
  it("leaves a short list alone", () => {
    const points = [{ values: { a: 1, b: 2 } }];
    const out = capAreaCategories(cats("a", "b"), points, 2);
    expect(out.folded).toBe(false);
    expect(out.kept.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out.points).toEqual(points);
  });

  it("keeps the biggest by total, in the caller's order, and folds the rest", () => {
    const points = [
      { values: { a: 1, b: 10, c: 5, d: 2 } },
      { values: { a: 1, b: 10, c: 5, d: 2 } },
    ];
    const out = capAreaCategories(cats("a", "b", "c", "d"), points, 2);
    expect(out.folded).toBe(true);
    expect(out.kept.map((c) => c.id)).toEqual(["b", "c"]);
    expect(out.points[0].values).toEqual({ b: 10, c: 5, [AREA_OTHER_ID]: 3 });
  });

  it("drops the smallest even when the caller ordered it first", () => {
    const out = capAreaCategories(cats("tiny", "big", "mid"), [{ values: { tiny: 1, big: 9, mid: 5 } }], 2);
    expect(out.kept.map((c) => c.id)).toEqual(["big", "mid"]);
  });

  it("omits Other from a point where nothing folded had a value", () => {
    const out = capAreaCategories(cats("a", "b", "c"), [{ values: { a: 5, b: 4, c: 1 } }, { values: { a: 1 } }], 2);
    expect(out.points[1].values).toEqual({ a: 1 });
  });

  it("carries a point's other fields through", () => {
    const x = new Date(2024, 0, 1);
    const out = capAreaCategories(cats("a", "b"), [{ x, values: { a: 1, b: 2 } }], 1);
    expect(out.points[0].x).toBe(x);
  });
});
