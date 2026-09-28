// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import * as d3 from "d3";
import { InteractiveDonut, ZOOM_DURATION_MS } from "./interactive-donut";
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

/** Only the center lines a sighted reader actually sees. The rest stay in
 * the DOM as screen-reader text, which `centerLines` still picks up. */
function visibleCenterLines(): string[] {
  const center = screen.getByRole("status", { name: /current selection/i });
  return [...center.children]
    .filter((el) => !el.classList.contains("sr-only"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
}

/** Only the drill-down trail's own buttons, not the excluded-slices
 * chips (#166) sharing the same `<nav>` row — those are scoped under
 * their own `[role=status]` span. */
function crumbs(): string[] {
  return [
    ...screen
      .getByRole("navigation", { name: /drill-down path/i })
      .querySelectorAll(':scope > span:not([role="status"]) > button'),
  ].map((b) => b.textContent ?? "");
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

  describe("center summary density", () => {
    // The hole is min(width, height) / (2 * (rings + 1)), so these sizes
    // pick the tier by geometry the same way a real viewport does.
    it("shows the full summary when the hole is big enough", () => {
      renderDonut({ width: 900, height: 900, visibleRings: 2 });
      expect(visibleCenterLines()).toEqual(["All places", "100", "visits"]);
    });

    it("drops the unit caption once the hole tightens", () => {
      renderDonut({ width: 560, height: 560, visibleRings: 2 });
      expect(visibleCenterLines()).toEqual(["All places", "100"]);
    });

    it("shows the name alone on a phone-sized chart", () => {
      // ~375px portrait at two rings — the case that prompted this.
      renderDonut({ width: 375, height: 375, visibleRings: 2 });
      expect(visibleCenterLines()).toEqual(["All places"]);
    });

    it("tightens for extra rings too, not just for narrow screens", () => {
      // Same width that gets the full summary at two rings; four rings
      // shrinks the hole past the threshold on its own.
      renderDonut({ width: 900, height: 900, visibleRings: 4 });
      expect(visibleCenterLines()).toEqual(["All places", "100"]);
    });

    it("keeps the omitted lines available to a screen reader", () => {
      renderDonut({ width: 375, height: 375, visibleRings: 2 });
      // Visually just the name, but the live region still announces the
      // whole summary when the focus changes.
      expect(visibleCenterLines()).toEqual(["All places"]);
      expect(centerLines()).toEqual(["All places", "100", "visits"]);
    });
  });

  it("renders nothing but the shell for a root with no children", () => {
    const { container } = renderDonut({ data: { key: "root", name: "Empty", value: 0 } });
    expect(arcs(container)).toHaveLength(0);
    expect(crumbs()).toEqual(["Empty"]);
  });

  describe("excluding a slice (#166)", () => {
    // The re-based total, the excluded chip and the "Showing X%" readout
    // all commit to React state immediately — `layout` never depends on
    // `excluded` (see the primitive's header comment), so there's nothing
    // gating that commit behind the animation the way a filtered-tree
    // approach would need. Only the *arc actually leaving the DOM* lags
    // behind, since it's animating to a hairline over the same 750ms
    // `zoomTo` uses rather than popping out of existence — `settle()`
    // below waits out that part specifically. Real time, not fake timers:
    // the d3 transition schedules itself off real timers/rAF, the same
    // reason `vitest.setup.ts`'s SVG geometry shim has to be permanent
    // rather than per-test.
    async function settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ZOOM_DURATION_MS + 50));
      });
    }

    it("right-clicking a slice re-bases the total immediately, then collapses the arc out of the DOM", async () => {
      const { container } = renderDonut();
      act(() => {
        arcFor(container, "fr").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });

      // Committed right away: the grand total re-bases to the remaining
      // 60 (Georgia 30 + NY 10, Atlanta already counted inside Georgia)
      // and the excluded row shows up — but the arc itself is still
      // mounted, mid-collapse to a hairline rather than gone yet.
      expect(centerLines()).toEqual(["All places", "60", "visits"]);
      expect(screen.getByText(/France \(40\)/)).toBeTruthy();
      expect(screen.getByText("Showing 60.0% of total")).toBeTruthy();
      expect(arcs(container).map(keyOf)).toContain("fr");

      await settle();

      // Now the collapse has finished, the arc is pruned from the DOM.
      expect(arcs(container).map(keyOf)).not.toContain("fr");
    });

    it("restores an excluded item on click, and grows the total back immediately", async () => {
      const { container } = renderDonut();
      act(() => {
        arcFor(container, "fr").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      expect(centerLines()).toEqual(["All places", "60", "visits"]);

      act(() => {
        screen.getByRole("button", { name: /France/i }).click();
      });
      expect(centerLines()).toEqual(["All places", "100", "visits"]);
      expect(screen.queryByText(/France \(40\)/)).toBeNull();
      // The arc is back in the DOM right away too, animating back in from
      // its collapsed hairline rather than popping back at full size.
      expect(arcs(container).map(keyOf)).toContain("fr");
    });

    it("captures a branch's effective weight, not its raw total, when a descendant was already excluded", async () => {
      // Atlanta (20) is nested inside Georgia (30 of its own, 50 raw
      // total including Atlanta). Excluding Atlanta first, then Georgia,
      // should credit Georgia's chip with 30 — its own weight once
      // Atlanta's is no longer double-counted — not the raw 50.
      const { container } = renderDonut({ visibleRings: 3 });
      act(() => {
        arcFor(container, "atl").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      act(() => {
        arcFor(container, "ga").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });

      expect(screen.getByText(/Georgia \(30\)/)).toBeTruthy();
      // Georgia's whole subtree (50, Atlanta included) is now gone from
      // the total — not double-subtracted just because Atlanta had its
      // own chip first: 100 - 50 = 50.
      expect(centerLines()).toEqual(["All places", "50", "visits"]);
    });

    it("excludes a nested branch via keyboard (Delete), leaving its siblings", async () => {
      const { container } = renderDonut({ visibleRings: 2 });
      act(() => {
        arcFor(container, "ga").dispatchEvent(
          new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }),
        );
      });
      await settle();

      expect(arcs(container).map(keyOf)).not.toContain("ga");
      expect(arcs(container).map(keyOf)).toContain("ny");
    });

    it("survives a zoom: excluding, then zooming into a different branch, keeps it excluded", async () => {
      const { container } = renderDonut();
      act(() => {
        arcFor(container, "fr").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      act(() => {
        arcFor(container, "usa").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(crumbs()).toEqual(["All places", "USA"]);
      expect(screen.getByText(/France \(40\)/)).toBeTruthy();
    });

    it("resets exclusions when the data prop changes", async () => {
      const { container, rerender } = renderDonut();
      act(() => {
        arcFor(container, "fr").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      await settle();
      expect(screen.getByText(/France \(40\)/)).toBeTruthy();

      rerender(<InteractiveDonut data={{ ...TREE }} width={600} height={600} valueLabel="visits" />);
      expect(screen.queryByText(/France \(40\)/)).toBeNull();
      expect(centerLines()).toEqual(["All places", "100", "visits"]);
    });
  });
});
