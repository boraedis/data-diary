// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InteractiveArea, type InteractiveAreaCategory, type InteractiveAreaPoint } from "./interactive-area";

// A mounted-DOM pass over #456's wiring that src/lib/viz/area-labels.test.ts
// can't reach: that labels replace the legend, that a band too thin for
// text gets no label but still gets its own hoverable band, and that more
// than five categories stay separate rather than folding.
//
// jsdom does no layout and has no text metrics, so the component's
// measurement falls back to an average glyph width. This proves which
// bands get labels, not how they look.

function months(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(2024, i, 1));
}

const CATEGORIES: InteractiveAreaCategory[] = [
  { id: "home", label: "Home" },
  { id: "partner", label: "Partner's place", alias: "Partner" },
  { id: "hotel", label: "Hotel" },
  { id: "family", label: "Family" },
  { id: "friend", label: "Friend" },
  { id: "transport", label: "Transport" },
  { id: "outdoors", label: "Outdoors" },
];

// Home dominates, the next four are mid-sized, and the last two are a
// sliver - thinner than the smallest label at this height.
const POINTS: InteractiveAreaPoint[] = months(12).map((x) => ({
  x,
  values: { home: 60, partner: 20, hotel: 15, family: 12, friend: 10, transport: 0.2, outdoors: 0.1 },
}));

function renderArea() {
  return render(<InteractiveArea categories={CATEGORIES} points={POINTS} width={900} height={500} mode="stacked" />);
}

describe("InteractiveArea labels (#456)", () => {
  it("draws no external legend", () => {
    const { container } = renderArea();
    expect(container.querySelector("button")).toBeNull();
  });

  it("gives every category its own band, with no Other", () => {
    const { container } = renderArea();
    const ids = [...container.querySelectorAll("g.area-band")].map((g) => g.getAttribute("data-category-id"));
    expect(ids).toEqual(CATEGORIES.map((c) => c.id));
    expect(container.textContent).not.toContain("Other");
  });

  it("labels the thick bands and skips the slivers", () => {
    const { container } = renderArea();
    const labelled = [...container.querySelectorAll("g.area-band")]
      .filter((g) => g.querySelector("text.area-label"))
      .map((g) => g.getAttribute("data-category-id"));
    expect(labelled).toEqual(expect.arrayContaining(["home", "partner", "hotel", "family", "friend"]));
    expect(labelled).not.toContain("transport");
    expect(labelled).not.toContain("outdoors");
  });

  it("sizes the dominant band's label larger than a smaller band's", () => {
    const { container } = renderArea();
    const size = (id: string) =>
      parseFloat(
        (container.querySelector(`g.area-band[data-category-id="${id}"] text.area-label`) as SVGTextElement).style.fontSize,
      );
    expect(size("home")).toBeGreaterThan(size("friend"));
  });

  it("keeps labels out of the way of band hover", () => {
    const { container } = renderArea();
    for (const label of container.querySelectorAll<SVGTextElement>("text.area-label")) {
      expect(label.style.pointerEvents).toBe("none");
    }
  });

  it("leaves no measurement probes behind", () => {
    const { container } = renderArea();
    expect(container.querySelector('text[visibility="hidden"]')).toBeNull();
  });
});
