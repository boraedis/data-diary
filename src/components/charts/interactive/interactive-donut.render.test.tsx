// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import * as d3 from "d3";
import { InteractiveDonut } from "./interactive-donut";
import type { HierarchyDatum } from "@/lib/viz/hierarchy";

// A mounted-DOM pass over what the pure-geometry tests in
// interactive-donut.test.ts can't reach: that the d3 render function
// actually runs, that the ring-visibility window is applied to real
// elements, and that a click on an arc drives both the zoom and the
// breadcrumb/center summary React renders from.
//
// jsdom does no layout, so this proves structure and wiring, not
// appearance — arc paths are pure math (d3.arc), but nothing here says the
// chart *looks* right. See the PR for what was verified visually.

const TREE: HierarchyDatum = {
  key: "root",
  name: "All places",
  children: [
    {
      key: "usa",
      name: "USA",
      children: [
        { key: "ga", name: "Georgia", value: 30, children: [{ key: "atl", name: "Atlanta", value: 20 }] },
        { key: "ny", name: "New York", value: 10 },
      ],
    },
    { key: "fr", name: "France", value: 40 },
  ],
};

function arcs(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("svg path")];
}

/** Finds an arc by the `key` of the node d3 bound to it. Reads d3's own
 * `__data__` expando rather than a `data-*` attribute, so the test isn't
 * asking the component to carry markup it only needs for testing. */
function arcFor(container: HTMLElement, key: string): SVGPathElement {
  const match = arcs(container).find(
    (path) => (d3.select(path).datum() as d3.HierarchyNode<HierarchyDatum> | undefined)?.data.key === key,
  );
  if (!match) throw new Error(`no arc bound to key "${key}"`);
  return match;
}

function visibleArcs(container: HTMLElement): SVGPathElement[] {
  return arcs(container).filter((p) => Number(p.getAttribute("fill-opacity")) > 0);
}

/** The center summary's stacked lines. Addressed through its live-region
 * role because that's the only stable handle for it — the arcs and the
 * breadcrumb repeat the same names, so a plain text query is ambiguous. */
function centerLines(): string[] {
  const center = screen.getByRole("status", { name: /current selection/i });
  return [...center.children].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
}

function crumbs(): string[] {
  return [...screen.getByRole("navigation", { name: /drill-down path/i }).querySelectorAll("button")].map(
    (b) => b.textContent ?? "",
  );
}

function renderDonut(props: Partial<React.ComponentProps<typeof InteractiveDonut>> = {}) {
  return render(<InteractiveDonut data={TREE} width={600} height={600} valueLabel="visits" {...props} />);
}

describe("InteractiveDonut", () => {
  it("draws one arc per descendant of the root", () => {
    const { container } = renderDonut();
    // usa, fr, ga, ny, atl — the root itself is the center disc, not a ring.
    expect(arcs(container)).toHaveLength(5);
    expect(arcs(container).every((p) => (p.getAttribute("d") ?? "").startsWith("M"))).toBe(true);
  });

  it("only paints arcs inside the visible ring window", () => {
    const { container } = renderDonut({ visibleRings: 1 });
    // Ring 1 only: USA and France. Georgia/New York/Atlanta wait for a zoom.
    expect(visibleArcs(container)).toHaveLength(2);

    const twoRings = renderDonut({ visibleRings: 2 });
    // + Georgia and New York.
    expect(visibleArcs(twoRings.container)).toHaveLength(4);
  });

  it("keeps off-screen arcs out of the tab order and out of pointer reach", () => {
    const { container } = renderDonut({ visibleRings: 1 });
    const hidden = arcs(container).filter((p) => Number(p.getAttribute("fill-opacity")) === 0);
    expect(hidden.length).toBeGreaterThan(0);
    for (const path of hidden) {
      expect(path.getAttribute("tabindex")).toBe("-1");
      expect(path.getAttribute("pointer-events")).toBe("none");
    }
    for (const path of visibleArcs(container)) {
      expect(path.getAttribute("tabindex")).toBe("0");
    }
  });

  it("summarizes the root in the center before any zoom", () => {
    renderDonut();
    // 30 + 20 + 10 + 40 — a node's own value plus its descendants'. No
    // share line at the root: "100% of itself" is noise.
    expect(centerLines()).toEqual(["All places", "100", "visits"]);
    expect(crumbs()).toEqual(["All places"]);
  });

  it("zooms into a branch on click, updating the breadcrumb and center", () => {
    const { container } = renderDonut();
    act(() => {
      arcFor(container, "usa").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(crumbs()).toEqual(["All places", "USA"]);
    // The center now reports USA's own subtree total, not the grand total,
    // plus what share of the whole that is.
    expect(centerLines()).toEqual(["USA", "60", "visits", "60.0% of All places"]);
  });

  it("does not zoom on a leaf click", () => {
    const { container } = renderDonut();
    act(() => {
      arcFor(container, "fr").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(crumbs()).toEqual(["All places"]);
  });

  it("walks back out through the breadcrumb", () => {
    const { container } = renderDonut();
    act(() => {
      arcFor(container, "usa").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(crumbs()).toEqual(["All places", "USA"]);

    act(() => {
      screen.getByRole("button", { name: "All places" }).click();
    });
    expect(crumbs()).toEqual(["All places"]);
  });

  it("renders nothing but the shell for a root with no children", () => {
    const { container } = renderDonut({ data: { key: "root", name: "Empty", value: 0 } });
    expect(arcs(container)).toHaveLength(0);
    expect(crumbs()).toEqual(["Empty"]);
  });
});
