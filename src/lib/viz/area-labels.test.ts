import { describe, expect, it } from "vitest";
import { capFontSize, fitBandLabel, fitBandLabelWithAlias, type BandProfile } from "@/lib/viz/area-labels";

const OPTIONS = { minFont: 7, capFont: 24, padX: 0, padY: 0 };

/** A band whose thickness at each x is given, centred on y = 100. */
function band(xs: number[], thickness: number[]): BandProfile {
  return {
    xs,
    bottoms: thickness.map((t) => 100 + t / 2),
    tops: thickness.map((t) => 100 - t / 2),
  };
}

describe("capFontSize", () => {
  it("is linear up to the cap and square-root past it", () => {
    expect(capFontSize(10, 24)).toBe(10);
    expect(capFontSize(24, 24)).toBe(24);
    expect(capFontSize(96, 24)).toBe(48);
  });
});

describe("fitBandLabel", () => {
  it("is limited by thickness on a wide, thin band", () => {
    const box = fitBandLabel(band([0, 500], [20, 20]), 4, OPTIONS);
    expect(box?.fitSize).toBeCloseTo(20);
    expect(box?.y).toBeCloseTo(100);
  });

  it("is limited by width on a narrow, thick band", () => {
    // 80px wide, ratio 4 → 20px of text, though 200px of height is free.
    const box = fitBandLabel(band([0, 80], [200, 200]), 4, OPTIONS);
    expect(box?.fitSize).toBeCloseTo(20);
    // Under the cap, so it's drawn at the size that fits.
    expect(box?.fontSize).toBeCloseTo(20);
  });

  it("finds the fat stretch of a band rather than its single widest point", () => {
    // A needle-thin spike at x=100, and a long 30px plateau from 300 to 500.
    const box = fitBandLabel(band([0, 99, 100, 101, 300, 400, 500], [5, 5, 90, 5, 30, 30, 30]), 4, OPTIONS);
    expect(box?.fitSize).toBeCloseTo(30);
    expect(box!.x).toBeGreaterThan(300);
  });

  it("returns null when the band never reaches the minimum size", () => {
    expect(fitBandLabel(band([0, 500], [6, 6]), 4, OPTIONS)).toBeNull();
  });

  it("returns null for a single point", () => {
    expect(fitBandLabel(band([10], [100]), 4, OPTIONS)).toBeNull();
  });

  it("samples between sparse points, so a box can end mid-segment", () => {
    // Two points only, tapering 60 → 0: the best box sits in the thick
    // half, which needs samples between the two points to find.
    const box = fitBandLabel(band([0, 400], [60, 0]), 2, OPTIONS);
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(200);
  });

  it("keeps the padding clear", () => {
    const box = fitBandLabel(band([0, 500], [20, 20]), 4, { ...OPTIONS, padY: 3 });
    expect(box?.fitSize).toBeCloseTo(14);
  });

  it("caps an oversized band's label", () => {
    const box = fitBandLabel(band([0, 2000], [96, 96]), 4, OPTIONS);
    expect(box?.fitSize).toBeCloseTo(96);
    expect(box?.fontSize).toBeCloseTo(48);
  });
});

describe("fitBandLabelWithAlias", () => {
  // 60px wide, 40px thick: "long" (ratio 6) fits 10px, "short" (ratio 2) fits 30px.
  const profile = band([0, 60], [40, 40]);

  it("switches to the alias when it fits much larger", () => {
    const fit = fitBandLabelWithAlias(profile, { text: "long", widthRatio: 6 }, { text: "short", widthRatio: 2 }, OPTIONS);
    expect(fit?.text).toBe("short");
  });

  it("keeps the full name when it already fits comfortably", () => {
    const wide = band([0, 1000], [40, 40]);
    const fit = fitBandLabelWithAlias(wide, { text: "long", widthRatio: 6 }, { text: "short", widthRatio: 2 }, OPTIONS);
    expect(fit?.text).toBe("long");
  });

  it("keeps the full name when the alias gains less than 1.5×", () => {
    const fit = fitBandLabelWithAlias(profile, { text: "long", widthRatio: 6 }, { text: "short", widthRatio: 5 }, OPTIONS);
    expect(fit?.text).toBe("long");
  });

  it("uses the alias when the full name doesn't fit at all", () => {
    const fit = fitBandLabelWithAlias(profile, { text: "long", widthRatio: 20 }, { text: "short", widthRatio: 6 }, OPTIONS);
    expect(fit?.text).toBe("short");
  });
});
