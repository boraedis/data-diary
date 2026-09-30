// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import * as d3 from "d3";
import { InteractiveTreemap } from "./interactive-treemap";
import type { HierarchyDatum } from "@/lib/viz/hierarchy";

// A mounted-DOM pass over what treemap.test.ts's pure rules can't reach:
// that the d3 render function runs, that groups and leaves both become
// tiles, and that a click drives the zoom and the breadcrumb React
// renders. jsdom does no layout, so this proves structure and wiring, not
// appearance — the tile geometry is d3's own math.

const TREE: HierarchyDatum = {
  key: "root",
  name: "Everyone",
  children: [
    {
      key: "family",
      name: "Family",
      color: "#aa0000",
      children: [
        { key: "alex", name: "Alex Morgan", value: 60 },
        { key: "sam", name: "Sam Lee", value: 20 },
      ],
    },
    { key: "jo", name: "Jo Park", value: 20 },
  ],
};

function tileFor(container: HTMLElement, key: string): SVGRectElement {
  const match = [...container.querySelectorAll<SVGRectElement>("svg rect")].find(
    (rect) => (d3.select(rect).datum() as d3.HierarchyNode<HierarchyDatum>).data.key === key,
  );
  if (!match) throw new Error(`no tile bound to key "${key}"`);
  return match;
}

describe("InteractiveTreemap", () => {
  it("draws a tile for every group and leaf, but not the root", () => {
    const { container } = render(<InteractiveTreemap data={TREE} width={600} height={400} />);
    expect(container.querySelectorAll("svg rect")).toHaveLength(4);
    expect(() => tileFor(container, "root")).toThrow();
  });

  it("sizes tiles in proportion to their value", () => {
    const { container } = render(<InteractiveTreemap data={TREE} width={600} height={400} />);
    const area = (key: string) => {
      const rect = tileFor(container, key);
      return Number(rect.getAttribute("width")) * Number(rect.getAttribute("height"));
    };
    // Family (80) against Jo (20), before Family's inset and header.
    expect(area("family") / area("jo")).toBeGreaterThan(3);
  });

  it("colours a branch from its own colour, tinted one step for its children", () => {
    const { container } = render(<InteractiveTreemap data={TREE} width={600} height={400} />);
    expect(tileFor(container, "alex").getAttribute("fill")).toBe("color-mix(in oklch, #aa0000, white 10%)");
    expect(tileFor(container, "family").getAttribute("fill")).toContain("#aa0000");
  });

  it("zooms into a tile's group on click, and back out from the breadcrumb", () => {
    const { container } = render(<InteractiveTreemap data={TREE} width={600} height={400} />);
    act(() => {
      tileFor(container, "alex").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Zoomed: Family's children fill the chart, Jo is gone.
    expect(container.querySelectorAll("svg rect")).toHaveLength(2);
    expect(() => tileFor(container, "jo")).toThrow();
    // Colour survives the zoom — it's read from the whole tree.
    expect(tileFor(container, "alex").getAttribute("fill")).toBe("#aa0000");

    act(() => {
      screen.getByRole("button", { name: "Everyone" }).click();
    });
    expect(container.querySelectorAll("svg rect")).toHaveLength(4);
  });

  it("does not zoom when zoomable is off", () => {
    const { container } = render(<InteractiveTreemap data={TREE} width={600} height={400} zoomable={false} />);
    act(() => {
      tileFor(container, "alex").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelectorAll("svg rect")).toHaveLength(4);
  });

  it("maxDepth draws a group as one tile carrying its whole value", () => {
    const { container } = render(<InteractiveTreemap data={TREE} width={600} height={400} maxDepth={1} />);
    expect(container.querySelectorAll("svg rect")).toHaveLength(2);
    const family = d3.select(tileFor(container, "family")).datum() as d3.HierarchyNode<HierarchyDatum>;
    expect(family.value).toBe(80);
  });
});
