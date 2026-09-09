// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as d3 from "d3";
import type { Feature, Geometry } from "geojson";
import { WorldVisitsChart } from "./world-visits-chart";

// Covers the half of #107 that only this chart has: the drill-down is
// offered for exactly one country and must stay inert for every other,
// falling back to the pre-#107 zoom-to-bounds rather than opening an
// empty subdivision view for a country with no geometry.
//
// jsdom does no layout, so this proves wiring and structure, not
// appearance. See the PR for what was verified visually.

class StubResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 900, height: 600 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

function regions(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("svg path")];
}

function nameOf(path: SVGPathElement): string | undefined {
  return (d3.select(path).datum() as Feature<Geometry, { name: string }> | undefined)?.properties.name;
}

function countryNamed(container: HTMLElement, name: string): SVGPathElement {
  const match = regions(container).find((p) => nameOf(p) === name);
  if (!match) throw new Error(`no country path for "${name}"`);
  return match;
}

const COUNTRIES = [
  { country: "USA", days: 5000 },
  { country: "France", days: 40 },
];
const STATES = [{ state: "Georgia", days: 1911 }];

describe("WorldVisitsChart", () => {
  it("drills into US states when the United States is clicked", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    const worldCount = regions(container).length;

    fireEvent.click(countryNamed(container, "United States of America"));
    await waitFor(() => expect(regions(container).length).not.toBe(worldCount));

    const names = regions(container).map(nameOf);
    expect(names).toHaveLength(51);
    expect(names).toContain("Georgia");
    expect(screen.getByRole("navigation", { name: /map drill-down/i }).textContent).toContain("United States");
  });

  it("leaves a country with no subdivision geometry on zoom-to-bounds", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    const worldCount = regions(container).length;

    fireEvent.click(countryNamed(container, "France"));

    // Nothing to await on a null drill-down, so give the microtask queue
    // a turn and assert the map genuinely did not swap levels.
    await Promise.resolve();
    expect(regions(container)).toHaveLength(worldCount);
    expect(screen.getByRole("navigation", { name: /map drill-down/i }).textContent).toContain("World");
  });

  it("offers no drill-down at all without state data (the recap's embed)", () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
    // No breadcrumb row means no reserved height for one either — the
    // recap's map is exactly what it was before #107.
    expect(screen.queryByRole("navigation", { name: /map drill-down/i })).toBeNull();
    expect(regions(container).length).toBeGreaterThan(0);
  });

  it("does not drill when a country is clicked in the recap's embed", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
    const worldCount = regions(container).length;
    fireEvent.click(countryNamed(container, "United States of America"));
    await Promise.resolve();
    expect(regions(container)).toHaveLength(worldCount);
  });
});
