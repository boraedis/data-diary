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

/** The `key` of the node d3 bound to an arc. Reads d3's own `__data__`
 * expando rather than a `data-*` attribute, so the test isn't asking the
 * component to carry markup it only needs for testing. */
function keyOf(path: SVGPathElement): string | undefined {
  return (d3.select(path).datum() as d3.HierarchyNode<HierarchyDatum> | undefined)?.data.key;
}

function arcFor(container: HTMLElement, key: string): SVGPathElement {
  const match = arcs(container).find((path) => keyOf(path) === key);
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
  it("mounts only the arcs inside the visible ring window", () => {
    // The whole point of isArcInPlay: a node outside the window owns no
    // DOM at all, rather than being a hidden element the browser still has
    // to lay out. Ring 1 only -> USA and France; Georgia, New York and
    // Atlanta don't exist yet.
    const oneRing = renderDonut({ visibleRings: 1 });
    expect(arcs(oneRing.container)).toHaveLength(2);
    expect(visibleArcs(oneRing.container)).toHaveLength(2);
    oneRing.unmount();

    // Two rings adds Georgia and New York, but still not Atlanta at depth 3.
    const { container } = renderDonut({ visibleRings: 2 });
    expect(arcs(container)).toHaveLength(4);
    expect(arcs(container).every((p) => (p.getAttribute("d") ?? "").startsWith("M"))).toBe(true);
  });

  it("mounts only the labels that are actually readable", () => {
    // One dominant slice plus a long tail of slivers — the shape a real
    // hierarchy has, and the reason labels get their own, much smaller
    // join: on the live places tree this is a dozen <text> nodes instead
    // of two thousand.
    const longTail: HierarchyDatum = {
      key: "root",
      name: "All",
      children: [
        { key: "big", name: "Dominant", value: 1000 },
        ...Array.from({ length: 40 }, (_, i) => ({ key: `t${i}`, name: `Sliver ${i}`, value: 1 })),
      ],
    };
    const { container } = renderDonut({ data: longTail, visibleRings: 1 });
    expect(arcs(container)).toHaveLength(41);
    expect(container.querySelectorAll("svg text").length).toBeLessThan(5);
  });

  it("makes every mounted arc keyboard-reachable", () => {
    const { container } = renderDonut({ visibleRings: 1 });
    for (const path of arcs(container)) {
      expect(path.getAttribute("tabindex")).toBe("0");
      expect(path.getAttribute("pointer-events")).toBe("auto");
    }
  });

  it("mounts the newly-revealed ring when a zoom brings it into the window", () => {
    const { container } = renderDonut({ visibleRings: 1 });
    // Atlanta lives two levels below the root, so it is absent at rest...
    expect(arcs(container).length).toBe(2);

    act(() => {
      arcFor(container, "usa").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // ...and exists once USA is the focus, so it has something to animate
    // in from rather than popping into place at the end.
    const keys = arcs(container).map(keyOf);
    expect(keys).toContain("ga");
    expect(keys).toContain("ny");
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
