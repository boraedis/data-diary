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

/** The region paths only. `path.geo-region` rather than every `svg path`
 * because an expanded region also draws an unfilled outline over its own
 * subdivisions — decoration, not a region, and counting it as one would
 * quietly inflate every assertion below. */
function regions(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("svg path.geo-region")];
}

/** The name of the GeoJSON feature d3 bound to a region path — read off
 * d3's own `__data__` expando, the same handle interactive-donut's render
 * test uses, rather than asking the component for a test-only attribute. */
function nameOf(path: SVGPathElement): string | undefined {
  // The bound datum is the component's own DrawnFeature — the feature
  // plus the accessors that read it, since states and counties share one
  // selection and each needs its own.
  const drawn = d3.select(path).datum() as { feature: Feature<Geometry, { name: string }> } | undefined;
  return drawn?.feature?.properties?.name;
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

  describe("county expansion (#107)", () => {
    // Fulton County, Georgia. The FIPS prefix (13) is Georgia's, which is
    // what the expansion filters the county layer by.
    const COUNTIES: UsCountyVisitData = {
      counties: [{ fips: "13121", name: "Fulton", days: 1891 }],
      unresolvedDays: 0,
    };

    function stateNamed(container: HTMLElement, name: string): SVGPathElement {
      const match = regions(container).find((p) => nameOf(p) === name);
      if (!match) throw new Error(`no state path for "${name}"`);
      return match;
    }

    /** Region paths only — the unfilled outline drawn over an expanded
     * state is decoration, not a region, and shouldn't be counted as one. */
    function regionNames(container: HTMLElement): (string | undefined)[] {
      return regions(container).map(nameOf);
    }

    it("starts with nothing expanded", () => {
      renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      const row = screen.getByRole("navigation", { name: /expanded regions/i });
      expect(row.textContent).toMatch(/click a region/i);
      expect(screen.queryByRole("button", { name: /collapse/i })).toBeNull();
    });

    it("replaces the clicked state with its counties, keeping every other state on the map", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      const names = regionNames(container);
      // Georgia's own polygon is gone, replaced by its 159 counties...
      expect(names).not.toContain("Georgia");
      expect(names.filter((n) => n === "Fulton")).toHaveLength(1);
      // ...while its neighbours are untouched and still clickable, which
      // is the entire point of expanding in place rather than swapping
      // the map out for a county-only view.
      expect(names).toContain("Alabama");
      expect(names).toContain("Florida");
      expect(names).toContain("Alaska");
      // 51 states - Georgia + its 159 counties.
      expect(names).toHaveLength(51 - 1 + 159);
    });

    it("lets a neighbour be opened directly, without collapsing the first", async () => {
      const { container } = renderChart(
        [
          { state: "Georgia", days: 100 },
          { state: "Alabama", days: 3 },
        ],
        COUNTIES,
      );
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      // Alabama is still a state polygon on screen, so it can be clicked
      // straight away — no going back up a level first.
      fireEvent.click(stateNamed(container, "Alabama"));
      await waitFor(() => expect(regionNames(container)).toContain("Mobile"));

      const names = regionNames(container);
      expect(names).not.toContain("Georgia");
      expect(names).not.toContain("Alabama");
      // Both open at once: Georgia's 159 + Alabama's 67.
      expect(names).toHaveLength(51 - 2 + 159 + 67);
      expect(screen.getAllByRole("button", { name: /collapse/i })).toHaveLength(2);
    });

    it("draws an outline over each expanded state so its border stays legible", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      expect(container.querySelectorAll("path.geo-expanded-outline")).toHaveLength(0);

      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      const outlines = container.querySelectorAll<SVGPathElement>("path.geo-expanded-outline");
      expect(outlines).toHaveLength(1);
      expect(outlines[0].getAttribute("fill")).toBe("none");
      expect(outlines[0].getAttribute("d")).toBeTruthy();
    });

    it("shades a county by its own data, on one scale shared with the states around it", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      const fillOf = (name: string) => regions(container).find((p) => nameOf(p) === name)?.getAttribute("fill");
      expect(fillOf("Fulton")).not.toBe("var(--muted)");
      // A county with no logged days reads as no data, same as an
      // unvisited state does.
      expect(fillOf("DeKalb")).toBe("var(--muted)");
    });

    it("collapses one state back to its own polygon, leaving others open", async () => {
      const { container } = renderChart(
        [
          { state: "Georgia", days: 100 },
          { state: "Alabama", days: 3 },
        ],
        COUNTIES,
      );
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));
      fireEvent.click(stateNamed(container, "Alabama"));
      await waitFor(() => expect(regionNames(container)).toContain("Mobile"));

      fireEvent.click(screen.getByRole("button", { name: /collapse georgia/i }));

      const names = regionNames(container);
      expect(names).toContain("Georgia");
      expect(names).not.toContain("Fulton");
      // Alabama stays open — collapsing is per-region, not a reset.
      expect(names).toContain("Mobile");
      expect(screen.getAllByRole("button", { name: /collapse/i })).toHaveLength(1);
    });
  });
});
