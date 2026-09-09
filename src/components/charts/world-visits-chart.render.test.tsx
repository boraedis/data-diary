// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as d3 from "d3";
import type { Feature, Geometry } from "geojson";
import { WorldVisitsChart } from "./world-visits-chart";

// Covers the half of #107 that only this chart has: expansion is offered
// for exactly one country and must stay inert for every other, falling
// back to the pre-#107 zoom-to-bounds rather than blanking a country with
// no geometry — plus the overlap trap that world-atlas already shipping
// its own Puerto Rico creates.
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

/** The region paths only. `path.geo-region` rather than every `svg path`
 * because an expanded region also draws an unfilled outline over its own
 * subdivisions — decoration, not a region, and counting it as one would
 * quietly inflate every assertion below. */
function regions(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("svg path.geo-region")];
}

function nameOf(path: SVGPathElement): string | undefined {
  // The bound datum is the component's own DrawnFeature — the feature
  // plus the accessors that read it, since states and counties share one
  // selection and each needs its own.
  const drawn = d3.select(path).datum() as { feature: Feature<Geometry, { name: string }> } | undefined;
  return drawn?.feature?.properties?.name;
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

/** The probe for "has the US expanded yet". Deliberately not Georgia:
 * world-atlas ships Georgia the *country*, so it's on this map before any
 * expansion happens and a waitFor on it would pass instantly without ever
 * waiting for the states to load. */
const CALIFORNIA = "California";

describe("WorldVisitsChart", () => {
  it("breaks the United States into its states, in place, when clicked", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    const worldCount = regions(container).length;

    fireEvent.click(countryNamed(container, "United States of America"));
    await waitFor(() => expect(regions(container).map(nameOf)).toContain(CALIFORNIA));

    const names = regions(container).map(nameOf);
    // The US polygon is replaced by the 50 states + DC...
    expect(names).not.toContain("United States of America");
    expect(names).toHaveLength(worldCount - 1 + 51);
    // ...and every other country is still drawn around them, which is
    // what makes it an expansion rather than a new map.
    expect(names).toContain("France");
    expect(names).toContain("Canada");
    expect(names).toContain("Mexico");
  });

  it("does not stack a second Puerto Rico on world-atlas's own", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    fireEvent.click(countryNamed(container, "United States of America"));
    await waitFor(() => expect(regions(container).map(nameOf)).toContain(CALIFORNIA));

    // world-atlas ships Puerto Rico as its own country feature, so the US
    // expansion must exclude us-atlas's — see loadUsStateFeatures.
    const names = regions(container).map(nameOf);
    expect(names.filter((n) => n === "Puerto Rico")).toHaveLength(1);
  });

  it("leaves a country with no subdivision geometry on zoom-to-bounds", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    const worldCount = regions(container).length;

    fireEvent.click(countryNamed(container, "France"));

    // Nothing to await on a null expansion, so give the microtask queue a
    // turn and assert the map genuinely did not change.
    await Promise.resolve();
    expect(regions(container)).toHaveLength(worldCount);
    expect(screen.queryByRole("button", { name: /collapse/i })).toBeNull();
  });

  it("collapses the US back to one polygon", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    const worldCount = regions(container).length;

    fireEvent.click(countryNamed(container, "United States of America"));
    await waitFor(() => expect(regions(container).map(nameOf)).toContain(CALIFORNIA));

    fireEvent.click(screen.getByRole("button", { name: "Collapse United States" }));

    const names = regions(container).map(nameOf);
    expect(names).toContain("United States of America");
    expect(names).not.toContain(CALIFORNIA);
    expect(names).toHaveLength(worldCount);
  });

  it("offers no expansion at all without state data (the recap's embed)", () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
    // No expansion row means no reserved height for one either — the
    // recap's map is exactly what it was before #107.
    expect(screen.queryByRole("navigation", { name: /expanded regions/i })).toBeNull();
    expect(regions(container).length).toBeGreaterThan(0);
  });

  it("does not expand when a country is clicked in the recap's embed", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
    const worldCount = regions(container).length;
    fireEvent.click(countryNamed(container, "United States of America"));
    await Promise.resolve();
    expect(regions(container)).toHaveLength(worldCount);
  });
});
