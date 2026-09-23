// @vitest-environment jsdom
import * as d3 from "d3";
import { describe, expect, it } from "vitest";
import { resolveCssColor } from "./interactive-calendar";

// Regression coverage for the bug reported against #410's Day Types
// Calendar: every cell rendered the same fixed color regardless of its
// actual day type, because blend mode's Lab-space color math (this file's
// own `blendColors`) fed `categoricalColor()`'s `var(--chart-N)` strings
// straight into `d3.lab()`, which can't parse either a CSS variable
// reference *or* this app's own oklch() token values — see
// resolveCssColor's own doc comment for the full two-step trace (a first
// attempt at this fix handled only the var() half and, caught here, would
// have kept every assertion below green while changing nothing real: the
// crucial case is a var() reference that resolves to an oklch() string,
// matching this app's actual tokens, not a pre-resolved hex value nobody's
// CSS ever produces). jsdom (not the suite's default "node" environment)
// is what lets this exercise `getComputedStyle` at all, the same reason
// us-state-visits-chart.render.test.tsx opts in.
describe("resolveCssColor", () => {
  it("resolves a var() reference through an oklch() token into something d3 can parse", () => {
    // This app's own dark-mode --chart-2 value (globals.css) — the exact
    // shape every real categoricalColor() call produces, not a stand-in.
    document.documentElement.style.setProperty("--chart-2", "oklch(0.64 0.16 80)");
    const resolved = resolveCssColor("var(--chart-2)");
    expect(d3.color(resolved)).not.toBeNull();
    const lab = d3.lab(resolved);
    expect(Number.isNaN(lab.l)).toBe(false);
  });

  it("passes an already-parseable color straight through untouched", () => {
    expect(resolveCssColor("#ff0000")).toBe("#ff0000");
    expect(resolveCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });

  it("falls back to the original (still-unparseable) string if the custom property is unset", () => {
    expect(resolveCssColor("var(--does-not-exist)")).toBe("var(--does-not-exist)");
  });

  it("converts a bare oklch() string even without a var() wrapper", () => {
    const resolved = resolveCssColor("oklch(0.49 0.13 150)");
    expect(d3.color(resolved)).not.toBeNull();
  });
});
