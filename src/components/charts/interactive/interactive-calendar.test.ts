// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveCssColor } from "./interactive-calendar";

// Regression coverage for the bug reported against #410's Day Types
// Calendar: every cell rendered the same fixed color regardless of its
// actual day type, because blend mode's Lab-space color math (this file's
// own `blendColors`) fed `categoricalColor()`'s `var(--chart-N)` strings
// straight into `d3.lab()`, which can't parse a CSS variable reference and
// silently returns NaN components — see resolveCssColor's own doc comment
// for the full trace. jsdom (not the suite's default "node" environment)
// is what lets this actually exercise `getComputedStyle`, the same reason
// us-state-visits-chart.render.test.tsx opts in.
describe("resolveCssColor", () => {
  it("resolves a var() reference to its computed value", () => {
    document.documentElement.style.setProperty("--chart-2", "#ab8f2c");
    expect(resolveCssColor("var(--chart-2)")).toBe("#ab8f2c");
  });

  it("passes through a color that isn't a var() reference", () => {
    expect(resolveCssColor("#ff0000")).toBe("#ff0000");
    expect(resolveCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });

  it("falls back to the original string if the custom property is unset", () => {
    expect(resolveCssColor("var(--does-not-exist)")).toBe("var(--does-not-exist)");
  });
});
