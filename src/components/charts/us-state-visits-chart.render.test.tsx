// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as d3 from "d3";
import type { Feature, Geometry } from "geojson";
import { UsStateVisitsChart } from "./us-state-visits-chart";
import type { UsCountyVisitData, UsStateVisitEntry } from "@/lib/charts";

// A mounted-DOM pass over the two things this chart does that nothing
// else in the codebase covers: that geoAlbersUsa actually produces real
// path geometry for every feature left after the territory filter (a
// projection that silently returns null for a feature renders a path with
// no `d` at all — invisible and unhoverable, the exact failure the filter
// exists to prevent), and that a resolved-but-undrawable territory still
// reaches the reader as text.
//
// jsdom does no layout, so this proves geometry and wiring, not
// appearance — nothing here says the map *looks* right. See the PR for
// what was verified visually.

// ResponsiveChart renders nothing until its ResizeObserver reports a
// size, and jsdom ships no ResizeObserver at all. This stub reports one
// fixed size immediately on observe(), which is all the component needs
// to hand a width/height down to the chart.
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

const NO_COUNTIES: UsCountyVisitData = { counties: [], unresolvedDays: 0 };

/** Most tests here only care about the state level, so county data
 * defaults to empty rather than every call site repeating it. */
function renderChart(data: UsStateVisitEntry[], counties: UsCountyVisitData = NO_COUNTIES) {
  return render(<UsStateVisitsChart data={data} counties={counties} />);
}

function regions(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("svg path")];
}

/** The name of the GeoJSON feature d3 bound to a region path — read off
 * d3's own `__data__` expando, the same handle interactive-donut's render
 * test uses, rather than asking the component for a test-only attribute. */
function nameOf(path: SVGPathElement): string | undefined {
  return (d3.select(path).datum() as Feature<Geometry, { name: string }> | undefined)?.properties.name;
}

describe("UsStateVisitsChart", () => {
  it("draws the 50 states and DC, and nothing geoAlbersUsa can't place", () => {
    const { container } = renderChart([{ state: "Georgia", days: 100 }]);
    const names = regions(container).map(nameOf);

    expect(names).toHaveLength(51);
    expect(names).toContain("District of Columbia");
    // Both non-contiguous states survive the filter — they're real states
    // the composite projection draws as insets, not territories.
    expect(names).toContain("Alaska");
    expect(names).toContain("Hawaii");
    for (const territory of ["Puerto Rico", "Guam", "American Samoa", "United States Virgin Islands"]) {
      expect(names).not.toContain(territory);
    }
  });

  it("gives every drawn state real path geometry", () => {
    const { container } = renderChart([{ state: "Georgia", days: 100 }]);
    // A feature the projection can't place gets no `d` at all. Asserting
    // on all 51 (not a sample) is what makes this a real check that the
    // FIPS cut and geoAlbersUsa's own coverage agree.
    for (const path of regions(container)) {
      expect(path.getAttribute("d"), `no path data for ${nameOf(path)}`).toBeTruthy();
    }
  });

  it("shades a state with data and leaves an unvisited one as an explicit no-data fill", () => {
    const { container } = renderChart([{ state: "Georgia", days: 100 }]);
    const fillFor = (name: string) => regions(container).find((p) => nameOf(p) === name)?.getAttribute("fill");

    expect(fillFor("Georgia")).not.toBe("var(--muted)");
    // Not an error, not a hole — a state with no logged days is a real,
    // muted "no data" fill (issue #287's own acceptance criterion).
    expect(fillFor("Wisconsin")).toBe("var(--muted)");
  });

  it("reports a resolved territory the map can't draw instead of dropping its days", () => {
    renderChart([
      { state: "Georgia", days: 100 },
      { state: "United States Virgin Islands", days: 3 },
    ]);
    expect(screen.getByText(/United States Virgin Islands \(3 days\)/)).toBeTruthy();
  });

  it("says nothing about off-map regions when every state resolves to a drawn one", () => {
    renderChart([{ state: "Georgia", days: 100 }]);
    expect(screen.queryByText(/Not drawn on this map/)).toBeNull();
  });

  it("renders the map with no visit data at all rather than failing", () => {
    const { container } = renderChart([]);
    expect(regions(container)).toHaveLength(51);
    for (const path of regions(container)) {
      expect(path.getAttribute("fill")).toBe("var(--muted)");
    }
  });

  it("reports US days that landed in no county, so they can't quietly vanish", () => {
    renderChart([{ state: "Illinois", days: 4 }], { counties: [], unresolvedDays: 2 });
    expect(screen.getByText(/2 days in the US couldn't be placed in a county/)).toBeTruthy();
  });

  describe("county drill-down (#107)", () => {
    // Fulton County, Georgia. The FIPS prefix (13) is Georgia's, which is
    // what the drill-down filters the county layer by.
    const FULTON = "13121";
    const COUNTIES: UsCountyVisitData = {
      counties: [{ fips: FULTON, name: "Fulton", days: 1891 }],
      unresolvedDays: 0,
    };

    function stateNamed(container: HTMLElement, name: string): SVGPathElement {
      const match = regions(container).find((p) => nameOf(p) === name);
      if (!match) throw new Error(`no state path for "${name}"`);
      return match;
    }

    it("starts at the root level with no way back out yet", () => {
      renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      const crumb = screen.getByRole("navigation", { name: /map drill-down/i });
      expect(crumb.textContent).toContain("United States");
      // Nothing above the root to click back to.
      expect(screen.queryByRole("button", { name: "United States" })).toBeNull();
    });

    it("swaps in the clicked state's counties and nothing else's", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));

      // The county layer is fetched by dynamic import on this click, so
      // the swap lands a tick later — exactly the behavior the async
      // resolveDrilldown contract exists for.
      await waitFor(() => expect(regions(container).length).not.toBe(51));

      const names = regions(container).map(nameOf);
      expect(names).toContain("Fulton");
      expect(names).toContain("DeKalb");
      // Georgia has 159 counties — the most of any state, and a number
      // worth pinning: getting the FIPS prefix filter wrong would either
      // draw all 3,231 or none.
      expect(names).toHaveLength(159);
      expect(names).not.toContain("Los Angeles");
    });

    it("shades a county by its own data and rescales to the drilled-in level", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regions(container).length).toBe(159));

      const fillOf = (name: string) => regions(container).find((p) => nameOf(p) === name)?.getAttribute("fill");
      expect(fillOf("Fulton")).not.toBe("var(--muted)");
      // A county with no logged days reads as no data, same as an
      // unvisited state one level up.
      expect(fillOf("DeKalb")).toBe("var(--muted)");
    });

    it("names the drilled-in level in the breadcrumb and goes back on click", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regions(container).length).toBe(159));

      const crumb = screen.getByRole("navigation", { name: /map drill-down/i });
      expect(crumb.textContent).toContain("Georgia");
      // The root is a link now that it's no longer the current level.
      const back = screen.getByRole("button", { name: "United States" });
      fireEvent.click(back);

      await waitFor(() => expect(regions(container).length).toBe(51));
      expect(regions(container).map(nameOf)).toContain("Georgia");
    });
  });
});
