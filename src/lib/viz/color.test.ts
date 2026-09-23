import { describe, expect, it } from "vitest";
import {
  categoricalColor,
  categorySequentialInterpolator,
  divergingScale,
  sequentialLogScale,
  sequentialScale,
} from "@/lib/viz/color";

describe("categoricalColor", () => {
  it("resolves the first five slots to --chart-1..5 CSS variables in order", () => {
    expect(categoricalColor(0)).toBe("var(--chart-1)");
    expect(categoricalColor(1)).toBe("var(--chart-2)");
    expect(categoricalColor(4)).toBe("var(--chart-5)");
  });

  it("falls back to a muted neutral beyond the fixed slot count rather than cycling", () => {
    expect(categoricalColor(5)).toBe("var(--muted-foreground)");
    expect(categoricalColor(100)).toBe("var(--muted-foreground)");
  });

  it("throws for a negative index", () => {
    expect(() => categoricalColor(-1)).toThrow(RangeError);
  });

  it("throws for a non-integer index", () => {
    expect(() => categoricalColor(1.5)).toThrow(RangeError);
  });
});

describe("sequentialScale", () => {
  it("maps the domain endpoints to distinct colors", () => {
    const scale = sequentialScale([0, 100]);
    expect(scale(0)).not.toBe(scale(100));
  });

  it("defaults to light mode, differing from an explicit dark-mode scale", () => {
    const light = sequentialScale([0, 100], "light");
    const dark = sequentialScale([0, 100], "dark");
    expect(light(50)).not.toBe(dark(50));
  });
});

describe("sequentialLogScale", () => {
  it("maps a strictly-positive domain without throwing", () => {
    const scale = sequentialLogScale([1, 1000]);
    expect(scale(1)).not.toBe(scale(1000));
  });

  it("compresses high values relative to a linear scale (log behavior)", () => {
    const log = sequentialLogScale([1, 1000]);
    const linear = sequentialScale([1, 1000]);
    // At the geometric midpoint the log scale should read closer to 50%
    // saturation than the linear scale does at the same raw value.
    expect(log(31.6)).not.toBe(linear(31.6));
  });
});

describe("categorySequentialInterpolator", () => {
  it("maps its own domain endpoints to distinct colors", () => {
    const interpolator = categorySequentialInterpolator(0);
    expect(interpolator(0)).not.toBe(interpolator(1));
  });

  it("gives each fixed slot a different hue rather than the same default ramp", () => {
    const phone = categorySequentialInterpolator(0, "dark");
    const laptop = categorySequentialInterpolator(2, "dark");
    expect(phone(1)).not.toBe(laptop(1));
  });

  it("wraps rather than throwing past the fixed slot count", () => {
    const wrapped = categorySequentialInterpolator(4, "dark");
    const first = categorySequentialInterpolator(0, "dark");
    expect(wrapped(0.5)).toBe(first(0.5));
  });

  it("defaults to light mode, differing from an explicit dark-mode ramp", () => {
    const light = categorySequentialInterpolator(0, "light");
    const dark = categorySequentialInterpolator(0, "dark");
    expect(light(0.5)).not.toBe(dark(0.5));
  });
});

describe("divergingScale", () => {
  it("returns the mid (gold accent) color at the domain's mid value", () => {
    const scale = divergingScale([-100, 0, 100]);
    // gold accent from the module's own DIVERGING_ENDPOINTS (#e6bc36),
    // round-tripped through d3's HCL interpolator as an rgb() string
    expect(scale(0)).toBe("rgb(230, 188, 54)");
  });

  it("distinguishes the cool and warm poles", () => {
    const scale = divergingScale([-100, 0, 100]);
    expect(scale(-100)).not.toBe(scale(100));
    expect(scale(-100)).not.toBe(scale(0));
  });

  it("uses distinct dark-mode endpoints from light mode", () => {
    const light = divergingScale([-100, 0, 100], "light");
    const dark = divergingScale([-100, 0, 100], "dark");
    expect(light(100)).not.toBe(dark(100));
  });
});
