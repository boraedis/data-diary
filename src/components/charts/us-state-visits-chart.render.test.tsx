// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// See interactive-geo.render.test.tsx's own comment on this stub — needed
// here too for the #370 hover tests below.
const originalPointerEvent = globalThis.PointerEvent;

beforeEach(() => {
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  globalThis.PointerEvent ??= class extends Event {} as unknown as typeof PointerEvent;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.PointerEvent = originalPointerEvent;
});

const NO_COUNTIES: UsCountyVisitData = { counties: [], unresolvedDays: 0 };

/** Most tests here only care about the state level, so county data
 * defaults to empty rather than every call site repeating it. */
function renderChart(
  data: UsStateVisitEntry[],
  counties: UsCountyVisitData = NO_COUNTIES,
  travelledCounties: string[] = [],
  extra: { travelledCountyDetails?: [string, { firstVisited: string | null; note: string | null }][]; diaryStartDate?: string | null } = {},
) {
  return render(
    <UsStateVisitsChart
      data={data}
      counties={counties}
      travelledCounties={travelledCounties}
      travelledCountyDetails={extra.travelledCountyDetails}
      diaryStartDate={extra.diaryStartDate}
    />,
  );
}

/** The map's own <svg>. Found through InteractiveGeo's labelled wrapper
 * (the role sits on that div, not the svg) rather than by taking the first
 * svg in the container — the page shell this component now renders puts
 * icon svgs ahead of it in the DOM. */
function mapSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('div[role="img"] svg');
  if (!svg) throw new Error("map svg not found");
  return svg;
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

  it("shows the card's empty state when nothing at all has been logged", () => {
    // This component owns its own ChartPage/ChartCard shell (the view
    // picker and the map share state), so `empty` now applies here rather
    // than on the page — which is what a reader with no data actually
    // sees. Before, this test rendered the map bare and never reached the
    // card at all.
    const { container } = renderChart([]);
    expect(regions(container)).toHaveLength(0);
  });

  it("draws every state, unshaded, when days exist but not in most states", () => {
    // The real "no value for this polygon" case: geoAlbersUsa still has to
    // produce path geometry for all 51, and each unvisited one takes the
    // muted no-data fill rather than a colour or a gap.
    const { container } = renderChart([{ state: "Georgia", days: 3 }]);
    expect(regions(container)).toHaveLength(51);
    const unshaded = regions(container).filter((p) => p.getAttribute("fill") === "var(--muted)");
    expect(unshaded).toHaveLength(50);
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
    const TWO_STATES = [
      { state: "Georgia", days: 100 },
      { state: "Alabama", days: 3 },
    ];

    function stateNamed(container: HTMLElement, name: string): SVGPathElement {
      const match = regions(container).find((p) => nameOf(p) === name);
      if (!match) throw new Error(`no state path for "${name}"`);
      return match;
    }

    function regionNames(container: HTMLElement): (string | undefined)[] {
      return regions(container).map(nameOf);
    }

    it("moves focus to a neighbour on click, restoring the first state's polygon", async () => {
      const { container } = renderChart(TWO_STATES, COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      // Alabama is still a state polygon on screen, so it can be clicked
      // straight away — no going back out first.
      fireEvent.click(stateNamed(container, "Alabama"));
      await waitFor(() => expect(regionNames(container)).toContain("Mobile"));

      const names = regionNames(container);
      // Only one region is subdivided at a time: Georgia is whole again.
      expect(names).toContain("Georgia");
      expect(names).not.toContain("Fulton");
      expect(names).not.toContain("Alabama");
      // 51 states - Alabama + its 67 counties.
      expect(names).toHaveLength(51 - 1 + 67);
    });

    it("keeps the open state open when one of its own counties is clicked", async () => {
      const { container } = renderChart(TWO_STATES, COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      // A county belongs to the state you drilled into — clicking it is
      // staying inside, not leaving. Collapsing here would read as the
      // map undoing the click that got you here.
      fireEvent.click(stateNamed(container, "Fulton"));

      const names = regionNames(container);
      expect(names).toContain("Fulton");
      expect(names).not.toContain("Georgia");
    });

    it("closes the open state when a state that can't expand is clicked", async () => {
      // Alaska has counties in us-atlas, so to get a genuinely
      // non-expandable region the resolver has to come back empty. The
      // component treats "resolved to nothing" the same as "no
      // subdivisions exist", which is the path a country with no geometry
      // takes on the world map.
      const { container } = renderChart(TWO_STATES, { counties: [], unresolvedDays: 0 });
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));
      expect(regionNames(container)).not.toContain("Georgia");

      // Clicking away from it puts Georgia back together.
      fireEvent.click(stateNamed(container, "Alabama"));
      await waitFor(() => expect(regionNames(container)).toContain("Georgia"));
      expect(regionNames(container)).not.toContain("Fulton");
    });

    it("draws exactly one outline, over whichever state is open", async () => {
      const { container } = renderChart(TWO_STATES, COUNTIES);
      expect(container.querySelectorAll("path.geo-expanded-outline")).toHaveLength(0);

      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));
      let outlines = container.querySelectorAll<SVGPathElement>("path.geo-expanded-outline");
      expect(outlines).toHaveLength(1);
      expect(outlines[0].getAttribute("fill")).toBe("none");
      expect(outlines[0].getAttribute("d")).toBeTruthy();

      fireEvent.click(stateNamed(container, "Alabama"));
      await waitFor(() => expect(regionNames(container)).toContain("Mobile"));
      outlines = container.querySelectorAll<SVGPathElement>("path.geo-expanded-outline");
      expect(outlines).toHaveLength(1);
    });

    it("keeps border strokes at a constant screen width so they sharpen when zoomed", () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES);
      // Without this the browser scales the stroke with the geometry, so
      // at 8x a 0.5px border paints 4px wide and starts swallowing small
      // counties whole.
      for (const path of regions(container)) {
        expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      }
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

    it("resets the whole map on a single background click", async () => {
      const { container } = renderChart(TWO_STATES, COUNTIES);
      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      // One click, not two: the collapse and the zoom-out are halves of
      // the same gesture. This used to take two because collapsing
      // rebuilt the SVG and killed the zoom-out transition mid-flight.
      // The map's own svg — see mapSvg.
      fireEvent.click(mapSvg(container));

      expect(regionNames(container)).toContain("Georgia");
      expect(regionNames(container)).not.toContain("Fulton");
      expect(regionNames(container)).toHaveLength(51);
    });

    it("shows no chrome naming the open region", async () => {
      const { container } = renderChart(TWO_STATES, COUNTIES);
      expect(screen.queryByRole("navigation")).toBeNull();

      fireEvent.click(stateNamed(container, "Georgia"));
      await waitFor(() => expect(regionNames(container)).toContain("Fulton"));

      // The outline says which region is open; there's nothing to
      // operate and nothing to close.
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.queryByRole("button", { name: /collapse/i })).toBeNull();
    });
  });

  describe("unlogged travel (#365)", () => {
    // #323's containment rule: a polygon whose only evidence of a visit is
    // travelled counties takes the tint; one with real logged days keeps
    // its real colour and is never downgraded.
    //
    // Fulton is in Georgia (FIPS 13121, so state 13); Mobile is in Alabama
    // (01097, state 01). Both are real us-atlas counties, which is what
    // makes the state roll-up assertions meaningful rather than circular.
    const FULTON = "13121";
    const MOBILE = "01097";

    function fillFor(container: HTMLElement, name: string): string | null | undefined {
      return regions(container).find((p) => nameOf(p) === name)?.getAttribute("fill");
    }

    it("tints a state whose only evidence is a travelled county", () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, [MOBILE]);

      // Alabama has no logged days, but contains a travelled county — so
      // it reads as travelled rather than as no-data.
      const alabama = fillFor(container, "Alabama");
      expect(alabama).not.toBe("var(--muted)");
      // ...and is distinct from a state that has neither.
      expect(fillFor(container, "Wisconsin")).toBe("var(--muted)");
      expect(alabama).not.toBe(fillFor(container, "Wisconsin"));
    });

    it("never downgrades a state that has real logged days", () => {
      // The half of the rule most likely to regress: Georgia has both 100
      // logged days and a travelled county in it, and must keep its place
      // on the sequential ramp.
      const withTravel = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, [FULTON]);
      const withoutTravel = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, []);

      expect(fillFor(withTravel.container, "Georgia")).toBe(fillFor(withoutTravel.container, "Georgia"));
    });

    it("leaves every state alone when nothing is travelled", () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, []);
      // Same assertion the pre-#365 no-data test makes — the default path
      // has to be untouched for a caller that passes no travelled data.
      expect(fillFor(container, "Alabama")).toBe("var(--muted)");
    });

    it("only describes the travelled tint in the aria label when some exists", () => {
      const without = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, []);
      expect(without.container.querySelector('div[role="img"]')?.getAttribute("aria-label")).not.toMatch(
        /travelled through/i,
      );

      const withTravel = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, [MOBILE]);
      expect(withTravel.container.querySelector('div[role="img"]')?.getAttribute("aria-label")).toMatch(
        /travelled through/i,
      );
    });

    it("carries the travelled set into a drilled-in state's counties", async () => {
      const { container } = renderChart(
        [{ state: "Georgia", days: 100 }],
        { counties: [], unresolvedDays: 0 },
        [FULTON],
      );

      fireEvent.click(regions(container).find((p) => nameOf(p) === "Georgia")!);
      await waitFor(() => expect(regions(container).map(nameOf)).toContain("Fulton"));

      // Fulton has no logged days here, but is travelled — so inside the
      // expansion it must read as travelled, not as no-data. This is the
      // wiring that would silently do nothing if the expansion didn't
      // carry its own accessor.
      const fulton = fillFor(container, "Fulton");
      expect(fulton).not.toBe("var(--muted)");

      // Some other polygon on the map — a neighbouring state, or one of
      // Georgia's other counties — with neither days nor travel is still
      // muted, so the above isn't just "everything got tinted".
      const others = regions(container).filter((p) => {
        const name = nameOf(p);
        return name !== undefined && name !== "Fulton" && name !== "Georgia";
      });
      expect(others.some((p) => p.getAttribute("fill") === "var(--muted)")).toBe(true);
    });
  });

  describe("first-visited tooltip row (#370)", () => {
    const tooltip = () => within(screen.getByRole("status"));
    // Fulton County, Georgia (FIPS 13121) — a real us-atlas county, same
    // fixture the county-expansion and unlogged-travel describes above use.
    const FULTON = "13121";
    const COUNTIES: UsCountyVisitData = {
      counties: [{ fips: FULTON, name: "Fulton", days: 1891, firstVisited: "2019-08-01" }],
      unresolvedDays: 0,
    };

    it("shows a logged state's own first-visit date in drill mode", () => {
      const { container } = renderChart(
        [{ state: "Georgia", days: 100, firstVisited: "2019-08-01" }],
        NO_COUNTIES,
        [],
        { diaryStartDate: "2016-01-01" },
      );
      fireEvent.focus(regions(container).find((p) => nameOf(p) === "Georgia")!);
      expect(tooltip().getByText("First visited Aug 2019")).toBeTruthy();
    });

    it("shows a logged county's own first-visit date inside the drilled-in expansion", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], COUNTIES, [], {
        diaryStartDate: "2016-01-01",
      });
      fireEvent.click(regions(container).find((p) => nameOf(p) === "Georgia")!);
      await waitFor(() => expect(regions(container).map(nameOf)).toContain("Fulton"));

      fireEvent.focus(regions(container).find((p) => nameOf(p) === "Fulton")!);
      expect(tooltip().getByText("First visited Aug 2019")).toBeTruthy();
    });

    it("falls back to a travelled county's own date when the county has no logged days", async () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }], NO_COUNTIES, [FULTON], {
        travelledCountyDetails: [[FULTON, { firstVisited: "2018-02-01", note: null }]],
      });
      fireEvent.click(regions(container).find((p) => nameOf(p) === "Georgia")!);
      await waitFor(() => expect(regions(container).map(nameOf)).toContain("Fulton"));

      fireEvent.focus(regions(container).find((p) => nameOf(p) === "Fulton")!);
      expect(tooltip().getByText("First visited Feb 2018")).toBeTruthy();
    });

    it("shows nothing extra for a state with no first-visit data at all", () => {
      const { container } = renderChart([{ state: "Georgia", days: 100 }]);
      fireEvent.focus(regions(container).find((p) => nameOf(p) === "Georgia")!);
      expect(tooltip().queryByText(/First (visited|logged)/)).toBeNull();
    });
  });
});
