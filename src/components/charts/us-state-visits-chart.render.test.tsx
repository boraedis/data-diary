// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import * as d3 from "d3";
import type { Feature, Geometry } from "geojson";
import { UsStateVisitsChart } from "./us-state-visits-chart";

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
    const { container } = render(<UsStateVisitsChart data={[{ state: "Georgia", days: 100 }]} />);
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
    const { container } = render(<UsStateVisitsChart data={[{ state: "Georgia", days: 100 }]} />);
    // A feature the projection can't place gets no `d` at all. Asserting
    // on all 51 (not a sample) is what makes this a real check that the
    // FIPS cut and geoAlbersUsa's own coverage agree.
    for (const path of regions(container)) {
      expect(path.getAttribute("d"), `no path data for ${nameOf(path)}`).toBeTruthy();
    }
  });

  it("shades a state with data and leaves an unvisited one as an explicit no-data fill", () => {
    const { container } = render(<UsStateVisitsChart data={[{ state: "Georgia", days: 100 }]} />);
    const fillFor = (name: string) => regions(container).find((p) => nameOf(p) === name)?.getAttribute("fill");

    expect(fillFor("Georgia")).not.toBe("var(--muted)");
    // Not an error, not a hole — a state with no logged days is a real,
    // muted "no data" fill (issue #287's own acceptance criterion).
    expect(fillFor("Wisconsin")).toBe("var(--muted)");
  });

  it("reports a resolved territory the map can't draw instead of dropping its days", () => {
    render(
      <UsStateVisitsChart
        data={[
          { state: "Georgia", days: 100 },
          { state: "United States Virgin Islands", days: 3 },
        ]}
      />,
    );
    expect(screen.getByText(/United States Virgin Islands \(3 days\)/)).toBeTruthy();
  });

  it("says nothing about off-map regions when every state resolves to a drawn one", () => {
    render(<UsStateVisitsChart data={[{ state: "Georgia", days: 100 }]} />);
    expect(screen.queryByText(/Not drawn on this map/)).toBeNull();
  });

  it("renders the map with no visit data at all rather than failing", () => {
    const { container } = render(<UsStateVisitsChart data={[]} />);
    expect(regions(container)).toHaveLength(51);
    for (const path of regions(container)) {
      expect(path.getAttribute("fill")).toBe("var(--muted)");
    }
  });
});
