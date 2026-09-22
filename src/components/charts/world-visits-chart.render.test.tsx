// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as d3 from "d3";
import type { Feature, Geometry } from "geojson";
import { WorldVisitsChart } from "./world-visits-chart";
import { travelledFill } from "@/lib/viz/color";

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

/** ISO 3166-1 numeric codes as world-atlas carries them, which is what
 * `unlogged_travel.code` stores for a country. Written out rather than
 * looked up from the atlas at test time: a test that derived the code the
 * same way the component does would pass even if both were wrong about
 * what the table holds. Verified against countries-50m.json. */
const CODE = { france: "250", mexico: "484", canada: "124" };

function fillFor(container: HTMLElement, name: string): string | null | undefined {
  return regions(container).find((p) => nameOf(p) === name)?.getAttribute("fill");
}

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
  });

  it("collapses the US back to one polygon on a single background click", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    const worldCount = regions(container).length;

    fireEvent.click(countryNamed(container, "United States of America"));
    await waitFor(() => expect(regions(container).map(nameOf)).toContain(CALIFORNIA));

    fireEvent.click(container.querySelector("svg")!);

    const names = regions(container).map(nameOf);
    expect(names).toContain("United States of America");
    expect(names).not.toContain(CALIFORNIA);
    expect(names).toHaveLength(worldCount);
  });

  it("closes the US when another country is clicked", async () => {
    const { container } = render(<WorldVisitsChart data={COUNTRIES} usStates={STATES} />);
    fireEvent.click(countryNamed(container, "United States of America"));
    await waitFor(() => expect(regions(container).map(nameOf)).toContain(CALIFORNIA));

    // France can't expand — there's no admin-1 geometry for it — but
    // clicking it is still clicking away from the US, so the US goes
    // back to being one polygon.
    fireEvent.click(countryNamed(container, "France"));

    const names = regions(container).map(nameOf);
    expect(names).toContain("United States of America");
    expect(names).not.toContain(CALIFORNIA);
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

  describe("countries the map can't draw (#383)", () => {
    it("draws the microstates the 110m atlas omitted entirely", () => {
      // Vatican City is the one that prompted the switch; the rest went
      // with it at 1:110m for the same size-threshold reason.
      const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
      const names = new Set(regions(container).map(nameOf));
      for (const n of ["Vatican", "San Marino", "Monaco", "Liechtenstein", "Andorra", "Malta", "Singapore"]) {
        expect(names.has(n), n).toBe(true);
      }
    });

    it("lists a country with logged days that it has no polygon for", () => {
      // The silent-loss guard. "Atlantis" stands in for the real case —
      // any catalog spelling normalizeCountryName doesn't reconcile.
      render(<WorldVisitsChart data={[...COUNTRIES, { country: "Atlantis", days: 7 }]} />);
      expect(screen.getByText(/Not drawn on this map/)).toBeTruthy();
      expect(screen.getByText(/Atlantis \(7 days\)/)).toBeTruthy();
    });

    it("says nothing when every country is drawable", () => {
      // The note is a report of a problem, so its absence has to mean
      // there isn't one — not that it was never wired up.
      render(<WorldVisitsChart data={COUNTRIES} />);
      expect(screen.queryByText(/Not drawn on this map/)).toBeNull();
    });

    it("counts a day correctly and sums repeats of the same unmatched name", () => {
      render(
        <WorldVisitsChart
          data={[
            { country: "Atlantis", days: 1 },
            { country: "Atlantis", days: 2 },
          ]}
        />,
      );
      expect(screen.getByText(/Atlantis \(3 days\)/)).toBeTruthy();
    });

    it("resolves an alias before calling it undrawable", () => {
      // "USA" is not a feature name, but normalizeCountryName maps it to
      // one — reporting it as missing would be a false alarm.
      render(<WorldVisitsChart data={[{ country: "USA", days: 5 }]} />);
      expect(screen.queryByText(/Not drawn on this map/)).toBeNull();
    });
  });

  describe("unlogged travel (#366)", () => {
    // #323's containment rule at country scale, plus the join #366 exists
    // to get right: on the feature's ISO id, never on its name.

    it("tints a country whose only evidence is an unlogged-travel entry", () => {
      const { container } = render(<WorldVisitsChart data={COUNTRIES} travelledCountries={[CODE.mexico]} />);

      expect(fillFor(container, "Mexico")).toBe(travelledFill("light"));
      // ...and a country with neither days nor travel is still no-data,
      // so the tint is distinguishing something rather than repainting
      // everything empty.
      expect(fillFor(container, "Canada")).toBe("var(--muted)");
    });

    it("never downgrades a country that has real logged days", () => {
      // France has 40 logged days *and* a travelled entry: it has to keep
      // its place on the sequential ramp. The half of the rule most
      // likely to regress.
      const withTravel = render(<WorldVisitsChart data={COUNTRIES} travelledCountries={[CODE.france]} />);
      const withoutTravel = render(<WorldVisitsChart data={COUNTRIES} />);

      expect(fillFor(withTravel.container, "France")).toBe(fillFor(withoutTravel.container, "France"));
      expect(fillFor(withTravel.container, "France")).not.toBe(travelledFill("light"));
    });

    it("joins on the ISO id, not the country's name", () => {
      // The distinction #366 turns on. `data` goes through
      // normalizeCountryName because the place catalog is free-text;
      // unlogged travel is a controlled list of codes and must not be
      // resolvable by name — a name that happens to match should paint
      // nothing.
      const { container } = render(<WorldVisitsChart data={COUNTRIES} travelledCountries={["Mexico"]} />);

      expect(fillFor(container, "Mexico")).toBe("var(--muted)");
      expect(screen.queryByText("travelled through")).toBeNull();
    });

    it("tints an id-less territory by its name, which is the code it's stored under", () => {
      // Kosovo, Somaliland and N. Cyprus carry no `id` in world-atlas, so
      // country-lookup.ts stores their name as the code. The chart's
      // fallback has to match, or those three become unrepresentable.
      const { container } = render(<WorldVisitsChart data={COUNTRIES} travelledCountries={["Kosovo"]} />);
      expect(fillFor(container, "Kosovo")).toBe(travelledFill("light"));
    });

    it("tints a state in the US expansion whose county is travelled", async () => {
      // Mobile County, Alabama (FIPS 01097, so state 01) — a real
      // us-atlas county, which is what makes the roll-up assertion
      // meaningful rather than circular. Alabama has no logged days here.
      const { container } = render(
        <WorldVisitsChart data={COUNTRIES} usStates={STATES} travelledCounties={["01097"]} />,
      );
      fireEvent.click(countryNamed(container, "United States of America"));
      await waitFor(() => expect(regions(container).map(nameOf)).toContain(CALIFORNIA));

      expect(fillFor(container, "Alabama")).toBe(travelledFill("light"));
      // A state with neither is untouched...
      expect(fillFor(container, "Wisconsin")).toBe("var(--muted)");
      // ...and so is a country outside the expansion, which answers this
      // question from an entirely different set.
      expect(fillFor(container, "Mexico")).toBe("var(--muted)");
    });

    it("does not let travelled counties leak onto the countries around them", async () => {
      // The expansion carries its own `isTravelled`; the base map's is the
      // country one. A county FIPS must never be read as a country code.
      const { container } = render(
        <WorldVisitsChart data={COUNTRIES} usStates={STATES} travelledCounties={["01097"]} />,
      );
      expect(fillFor(container, "Canada")).toBe("var(--muted)");
      expect(screen.queryByText("travelled through")).toBeNull();
    });

    it("names the tint in the legend only once something on screen has it", () => {
      const without = render(<WorldVisitsChart data={COUNTRIES} />);
      expect(within(without.container).queryByText("travelled through")).toBeNull();

      const withTravel = render(<WorldVisitsChart data={COUNTRIES} travelledCountries={[CODE.canada]} />);
      expect(within(withTravel.container).getByText("travelled through")).toBeTruthy();
    });

    it("says so in the aria label, and only when it is true", () => {
      const without = render(<WorldVisitsChart data={COUNTRIES} />);
      expect(within(without.container).getByRole("img").getAttribute("aria-label")).not.toMatch(/travelled/i);

      const withTravel = render(<WorldVisitsChart data={COUNTRIES} travelledCountries={[CODE.canada]} />);
      expect(within(withTravel.container).getByRole("img").getAttribute("aria-label")).toMatch(/travelled through/i);
    });

    it("renders the recap's embed exactly as before, since it passes none", () => {
      // #366's written decision: dateless entries must not be painted into
      // a period-scoped map. This is that decision as a test.
      const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
      expect(regions(container).every((p) => p.getAttribute("fill") !== travelledFill("light"))).toBe(true);
    });
  });

  describe("first-visited tooltip row (#370)", () => {
    const tooltip = () => within(screen.getByRole("status"));
    const DATED_COUNTRIES = [
      { country: "USA", days: 5000, firstVisited: "2020-03-14" },
      { country: "France", days: 40, firstVisited: "2016-01-01" },
    ];

    it("shows a logged country's own first-visit date, label and value in separate (unswatched) rows", () => {
      const { container } = render(<WorldVisitsChart data={DATED_COUNTRIES} diaryStartDate="2016-01-01" />);
      fireEvent.focus(countryNamed(container, "United States of America"));
      expect(tooltip().getByText("First visited")).toBeTruthy();
      expect(tooltip().getByText("Mar 2020")).toBeTruthy();
    });

    it("reads 'first logged' once the date lands at or before the diary's own start", () => {
      const { container } = render(<WorldVisitsChart data={DATED_COUNTRIES} diaryStartDate="2016-01-01" />);
      fireEvent.focus(countryNamed(container, "France"));
      expect(tooltip().getByText("First logged")).toBeTruthy();
      expect(tooltip().getByText("Jan 2016")).toBeTruthy();
    });

    it("falls back to the travelled entry's own date for a country with no logged days", () => {
      const { container } = render(
        <WorldVisitsChart
          data={COUNTRIES}
          travelledCountries={[CODE.mexico]}
          travelledCountryDetails={[[CODE.mexico, { firstVisited: "2019-05-01", note: null }]]}
        />,
      );
      fireEvent.focus(countryNamed(container, "Mexico"));
      expect(tooltip().getByText("First visited")).toBeTruthy();
      expect(tooltip().getByText("May 2019")).toBeTruthy();
    });

    it("says the date is unknown rather than omitting the row for a dateless travelled entry", () => {
      const { container } = render(
        <WorldVisitsChart
          data={COUNTRIES}
          travelledCountries={[CODE.mexico]}
          travelledCountryDetails={[[CODE.mexico, { firstVisited: null, note: null }]]}
        />,
      );
      fireEvent.focus(countryNamed(container, "Mexico"));
      expect(tooltip().getByText("First visited")).toBeTruthy();
      expect(tooltip().getByText("date unknown")).toBeTruthy();
    });

    it("shows nothing extra for a country with neither logged days nor travel", () => {
      const { container } = render(<WorldVisitsChart data={COUNTRIES} />);
      fireEvent.focus(countryNamed(container, "Canada"));
      expect(tooltip().queryByText(/First (visited|logged)/)).toBeNull();
    });
  });
});
