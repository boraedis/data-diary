// @vitest-environment jsdom
import * as d3 from "d3";
import { describe, expect, it } from "vitest";
import { resolveCssColor } from "./interactive-calendar";

// Regression coverage for the bug reported against #410's Day Types
// Calendar: every cell rendered the same fixed color regardless of its
// actual day type. Three attempts at this fix each assumed a different,
// wrong shape for what `getComputedStyle(...).getPropertyValue('--chart-N')`
// actually returns — see resolveCssColor's own doc comment for the full
// three-step trace of what each attempt got wrong and how it was checked
// (the second-to-last test below uses the exact string captured live from
// this app's own deployed page via the browser console, not a guess).
//
// jsdom (not the suite's default "node" environment) is what lets this
// exercise `getComputedStyle` at all, the same reason
// us-state-visits-chart.render.test.tsx opts in — but jsdom's own CSS
// engine does NOT reproduce a real browser's oklch()->lab() custom-property
// normalization (it just echoes back whatever string was set), so these
// tests set the property directly to each format's real shape rather than
// relying on jsdom to convert one into the other.
describe("resolveCssColor", () => {
  it("resolves a var() reference whose computed value is a CSS lab() string — the actual shape a real browser returns for this app's oklch() tokens (verified live, not assumed)", () => {
    // Captured via `getComputedStyle(document.documentElement)
    // .getPropertyValue('--chart-1')` on the deployed preview, dark mode —
    // not jsdom's own (much more primitive) echo of whatever was set.
    document.documentElement.style.setProperty("--chart-1", "lab(42.9085% 49.4307 59.7159)");
    const resolved = resolveCssColor("var(--chart-1)");
    expect(d3.color(resolved)).not.toBeNull();
    const lab = d3.lab(resolved);
    expect(Number.isNaN(lab.l)).toBe(false);
    // Should round-trip close to the source Lab values (small rounding
    // from the hex quantization in between), not land on some unrelated
    // fallback color.
    expect(lab.l).toBeCloseTo(42.9, 0);
  });

  it("converts a bare oklch() string too, as a defensive fallback for a browser that doesn't normalize it", () => {
    const resolved = resolveCssColor("oklch(0.49 0.13 150)");
    expect(d3.color(resolved)).not.toBeNull();
  });

  it("passes an already-parseable color straight through untouched", () => {
    expect(resolveCssColor("#ff0000")).toBe("#ff0000");
    expect(resolveCssColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });

  it("falls back to the original (still-unparseable) string if the custom property is unset", () => {
    expect(resolveCssColor("var(--does-not-exist)")).toBe("var(--does-not-exist)");
  });
});
