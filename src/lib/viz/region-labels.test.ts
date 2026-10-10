import { describe, expect, it } from "vitest";
import { labelMinZoom, labelWidthPx, REGION_LABEL_FONT_PX } from "./region-labels";

describe("labelMinZoom", () => {
  it("is Infinity for a degenerate polygon", () => {
    expect(labelMinZoom("Midtown", { width: 0, height: 10, area: 0 })).toBe(Infinity);
    expect(labelMinZoom("Midtown", { width: 10, height: 10, area: 0 })).toBe(Infinity);
  });

  it("needs less zoom for a bigger polygon", () => {
    const small = labelMinZoom("Midtown", { width: 20, height: 20, area: 300 });
    const large = labelMinZoom("Midtown", { width: 80, height: 80, area: 5000 });
    expect(large).toBeLessThan(small);
  });

  it("needs more zoom for a longer name", () => {
    const box = { width: 60, height: 60, area: 2500 };
    expect(labelMinZoom("Historic Westin Heights/Bankhead", box)).toBeGreaterThan(labelMinZoom("Inman Park", box));
  });

  it("fits at k=1 exactly when the text and its padding fit the box", () => {
    const text = "Midtown";
    const fits = { width: labelWidthPx(text) + 20, height: REGION_LABEL_FONT_PX * 3, area: 10_000 };
    expect(labelMinZoom(text, fits)).toBeLessThanOrEqual(1);
    const tooNarrow = { ...fits, width: labelWidthPx(text) / 2 };
    expect(labelMinZoom(text, tooNarrow)).toBeGreaterThan(1);
  });

  it("holds a thin sliver back even when its bounding box is large", () => {
    const sliver = { width: 200, height: 200, area: 400 };
    const blob = { width: 200, height: 200, area: 30_000 };
    expect(labelMinZoom("Midtown", sliver)).toBeGreaterThan(labelMinZoom("Midtown", blob));
  });
});
