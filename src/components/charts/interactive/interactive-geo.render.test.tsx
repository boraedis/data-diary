// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as d3 from "d3";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { InteractiveGeo } from "./interactive-geo";
import { noDataFill, travelledFill } from "@/lib/viz/color";

// #364's three-state fill: a value on the sequential ramp, the flat
// "travelled through" tint, and the muted no-data fill — plus the
// precedence between them.
//
// The no-data expectation goes through `noDataFill()` rather than a
// literal, same as the travelled one goes through `travelledFill()`: #426
// moved that fill off `var(--muted)` onto its own constant, and hardcoding
// either value here only re-breaks this file (and the us-state/world
// render tests, which do the same) the next time the colour is tuned.
// What's under test is which state a region resolves to, not the hex.
//
// Tests the primitive directly rather than through a chart, because #364
// deliberately ships without a consumer (#365/#366 wire the maps up). The
// existing us-state/world render tests cover the two-state behaviour
// through their own charts and must keep passing unchanged — that's the
// "every pre-#364 caller renders exactly as before" claim.
//
// jsdom does no layout, so this proves fill resolution and legend/tooltip
// wiring, not appearance. See the PR for what was verified visually.

// attachMarkHover branches on `event instanceof PointerEvent` to decide
// where to put the tooltip. jsdom defines no PointerEvent at all, so that
// expression doesn't evaluate false — it throws a ReferenceError and
// takes the handler with it. Stubbing the global (the same shape the
// sibling render tests stub ResizeObserver) lets the check evaluate
// normally; a focus event isn't an instance of it, so the handler takes
// its getBoundingClientRect branch, which is the real keyboard path
// anyway. Not a production concern: every browser defines PointerEvent.
const originalPointerEvent = globalThis.PointerEvent;

beforeEach(() => {
  globalThis.PointerEvent ??= class extends Event {} as unknown as typeof PointerEvent;
});

afterEach(() => {
  globalThis.PointerEvent = originalPointerEvent;
});

type Props = { name: string };

/** A 1x1 degree square at the given longitude — enough for d3.geoPath to
 * produce a real path; the geometry itself is never asserted on. */
function square(name: string, lon: number): Feature<Geometry, Props> {
  return {
    type: "Feature",
    id: name,
    properties: { name },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, 0],
          [lon + 1, 0],
          [lon + 1, 1],
          [lon, 1],
          [lon, 0],
        ],
      ],
    },
  };
}

function collection(...names: string[]): FeatureCollection<Geometry, Props> {
  return { type: "FeatureCollection", features: names.map((n, i) => square(n, i * 2)) };
}

function regionNamed(container: HTMLElement, name: string): SVGPathElement {
  const match = [...container.querySelectorAll<SVGPathElement>("svg path.geo-region")].find((p) => {
    const drawn = d3.select(p).datum() as { feature: Feature<Geometry, Props> } | undefined;
    return drawn?.feature?.properties?.name === name;
  });
  if (!match) throw new Error(`no region path for "${name}"`);
  return match;
}

const fillOf = (container: HTMLElement, name: string) => regionNamed(container, name).getAttribute("fill");

/** The hover tooltip. `role="status"` is unambiguous here — the only
 * other element carrying it is the expansion's "Loading…" caption, which
 * needs an in-flight `resolveExpansion` these tests never pass. Scoping
 * matters because the legend now names the same states the tooltip does,
 * so a bare `getByText("travelled through")` matches both. */
const tooltip = () => within(screen.getByRole("status"));

/** Two logged regions, so the log scale gets a real (non-degenerate)
 * domain, plus one travelled and one empty. */
function renderMap(overrides: Partial<Parameters<typeof InteractiveGeo<Props>>[0]> = {}) {
  const days: Record<string, number> = { Logged: 3, AlsoLogged: 40 };
  const travelled = new Set(["Travelled"]);
  return render(
    <InteractiveGeo<Props>
      features={collection("Logged", "AlsoLogged", "Travelled", "Empty")}
      width={600}
      height={400}
      getValue={(f) => days[f.properties.name] ?? null}
      isTravelled={(f) => travelled.has(f.properties.name)}
      getLabel={(f) => f.properties.name}
      valueLabel="days"
      {...overrides}
    />,
  );
}

describe("InteractiveGeo travelled fill", () => {
  it("paints the three states distinctly", () => {
    const { container } = renderMap();
    const logged = fillOf(container, "Logged");
    const travelled = fillOf(container, "Travelled");
    const empty = fillOf(container, "Empty");

    expect(travelled).toBe(travelledFill("light"));
    expect(empty).toBe(noDataFill());
    // A real value lands on the ramp, which is neither of the other two.
    expect(logged).not.toBe(travelled);
    expect(logged).not.toBe(empty);
  });

  it("keeps a region on the ramp when it has both a value and a travelled record", () => {
    // The precedence that #365's containment rule depends on: a region
    // with genuinely logged days is never downgraded to the tint by an
    // overlapping travelled record. The case most likely to regress.
    const { container } = renderMap({ isTravelled: () => true });

    expect(fillOf(container, "Logged")).not.toBe(travelledFill("light"));
    expect(fillOf(container, "AlsoLogged")).not.toBe(travelledFill("light"));
    // ...while a region with no value still takes it.
    expect(fillOf(container, "Empty")).toBe(travelledFill("light"));
  });

  it("names both off-ramp fills in the legend", () => {
    renderMap();
    expect(screen.getByText("travelled through")).toBeTruthy();
    expect(screen.getByText("no data")).toBeTruthy();
  });

  it("omits the travelled legend entry when nothing on screen is travelled", () => {
    // Naming a state nothing is in reads as a claim about the data
    // ("none of these are travelled") rather than a key to the map.
    renderMap({ isTravelled: () => false });
    expect(screen.queryByText("travelled through")).toBeNull();
    expect(screen.getByText("no data")).toBeTruthy();
  });

  it("renders unchanged for a caller that passes no isTravelled at all", () => {
    const { container } = renderMap({ isTravelled: undefined });
    expect(fillOf(container, "Travelled")).toBe(noDataFill());
    expect(screen.queryByText("travelled through")).toBeNull();
  });

  it("tells a travelled region apart from an empty one on hover", () => {
    const { container } = renderMap();

    // `focus` rather than a pointer event: attachMarkHover listens for
    // both, and jsdom has no PointerEvent constructor.
    fireEvent.focus(regionNamed(container, "Travelled"));
    expect(tooltip().getByText("travelled through")).toBeTruthy();
    // The tooltip must not call it "no data" — the opposite of true for a
    // region we know was visited.
    expect(tooltip().queryByText("no data")).toBeNull();

    fireEvent.blur(regionNamed(container, "Travelled"));
    fireEvent.focus(regionNamed(container, "Empty"));
    expect(tooltip().getByText("no data")).toBeTruthy();
    expect(tooltip().queryByText("travelled through")).toBeNull();
  });

  it("shows a real value's own row on hover, unaffected by the new states", () => {
    const { container } = renderMap();
    fireEvent.focus(regionNamed(container, "AlsoLogged"));
    expect(tooltip().getByText("days")).toBeTruthy();
    expect(tooltip().getByText("40")).toBeTruthy();
    expect(tooltip().queryByText("travelled through")).toBeNull();
  });
});

// #370's region-level secondary row, the getMarkerSecondaryValue counterpart
// for a region rather than a marker. Its label/value split (rather than one
// composed string) is what lets the row render with the usual
// bold-value/muted-label weighting instead of the whole row reading bold,
// and it carries no color swatch — this row isn't naming a fill.
describe("InteractiveGeo region secondary row", () => {
  it("shows the accessor's own label and value below the value row, with no swatch", () => {
    const { container } = renderMap({
      getSecondaryValue: (f) =>
        f.properties.name === "AlsoLogged" ? { label: "First visited", value: "Mar 2016" } : null,
    });
    fireEvent.focus(regionNamed(container, "AlsoLogged"));
    const label = tooltip().getByText("First visited");
    const value = tooltip().getByText("Mar 2016");
    expect(label).toBeTruthy();
    expect(value).toBeTruthy();
    // Label before value ("First visited Mar 2016"), not the default
    // value-first order every other row uses ("42 days") — this row reads
    // as a labelled fact, not a magnitude-then-unit phrase.
    expect(label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No third swatch alongside the value row's own — this row doesn't
    // identify a color the way the fill row above it does.
    const swatches = screen.getByRole("status").querySelectorAll("[aria-hidden]");
    expect(swatches).toHaveLength(1);
  });

  it("shows nothing extra for a region the accessor returns null for", () => {
    const { container } = renderMap({
      getSecondaryValue: (f) =>
        f.properties.name === "AlsoLogged" ? { label: "First visited", value: "Mar 2016" } : null,
    });
    fireEvent.focus(regionNamed(container, "Logged"));
    expect(tooltip().queryByText("First visited")).toBeNull();
  });

  it("also shows on a travelled region, not just a valued one", () => {
    const { container } = renderMap({
      getSecondaryValue: (f) =>
        f.properties.name === "Travelled" ? { label: "First visited", value: "date unknown" } : null,
    });
    fireEvent.focus(regionNamed(container, "Travelled"));
    expect(tooltip().getByText("travelled through")).toBeTruthy();
    expect(tooltip().getByText("date unknown")).toBeTruthy();
  });

  it("renders unchanged for a caller that passes no getSecondaryValue at all", () => {
    const { container } = renderMap({ getSecondaryValue: undefined });
    fireEvent.focus(regionNamed(container, "AlsoLogged"));
    expect(tooltip().getByText("days")).toBeTruthy();
    expect(tooltip().queryByText("First visited")).toBeNull();
  });
});

// #215's additions: a plain base map under markers, routes between them,
// and per-marker styling/labels.
describe("InteractiveGeo base map, routes and marker annotations", () => {
  const markers = [
    { id: "home", position: [0.5, 0.5] as [number, number], label: "Home", color: "red", radius: 9, opacity: 0.3 },
    { id: "2019", position: [4.5, 0.5] as [number, number], label: "2019", annotation: "2019–2020" },
  ];

  it("draws regions in one neutral fill with no legend and no region tooltip", () => {
    const { container } = renderMap({ regionsAsBasemap: true, markers });
    expect(fillOf(container, "Logged")).toBe(noDataFill());
    expect(fillOf(container, "Travelled")).toBe(noDataFill());
    expect(screen.queryByText("no data")).toBeNull();
    fireEvent.focus(regionNamed(container, "Logged"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("draws a route, dashed only when asked", () => {
    const { container } = renderMap({
      markers,
      routes: [
        { id: "a", coordinates: [[0.5, 0.5], [4.5, 0.5]] },
        { id: "b", coordinates: [[4.5, 0.5], [2.5, 0.5]], dashed: true },
      ],
    });
    const paths = [...container.querySelectorAll("g.geo-routes path")];
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute("stroke-dasharray")).toBeNull();
    expect(paths[1].getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("applies a marker's own colour, opacity and fixed radius, and draws its annotation", () => {
    const { container } = renderMap({ markers });
    const [home, stop] = [...container.querySelectorAll("circle.geo-marker")];
    expect(home.getAttribute("fill")).toBe("red");
    expect(home.getAttribute("fill-opacity")).toBe("0.3");
    expect(home.getAttribute("r")).toBe("9");
    expect(stop.getAttribute("fill-opacity")).toBe("0.85");
    const labels = [...container.querySelectorAll("text.geo-annotation")].map((t) => t.textContent);
    expect(labels).toEqual(["2019–2020"]);
  });

  it("uses a secondary row's own label when the accessor returns one", () => {
    const { container } = renderMap({
      markers,
      getMarkerValue: () => 12,
      getMarkerSecondaryValue: (m) => (m.id === "home" ? { label: "share", value: "58%" } : "plain"),
      markerSecondaryLabel: "detail",
    });
    const [home, stop] = [...container.querySelectorAll("circle.geo-marker")];
    fireEvent.focus(home);
    expect(tooltip().getByText("share")).toBeTruthy();
    expect(tooltip().getByText("58%")).toBeTruthy();
    fireEvent.blur(home);
    fireEvent.focus(stop);
    expect(tooltip().getByText("detail")).toBeTruthy();
  });
});

describe("InteractiveGeo hit radius and marker detail", () => {
  it("draws a small dot with a transparent ring out to its hit radius", () => {
    const { container } = renderMap({
      markers: [{ id: "p", position: [0.5, 0.5], label: "Mar 2019", radius: 2, hitRadius: 7 }],
    });
    const dot = container.querySelector("circle.geo-marker")!;
    expect(dot.getAttribute("r")).toBe("2");
    expect(dot.getAttribute("stroke")).toBe("transparent");
    // The ring is centred on the edge, so 10px wide reaches out to r = 7.
    expect(dot.getAttribute("stroke-width")).toBe("10");
  });

  it("renders the detail accessor's content under the tooltip rows", () => {
    const { container } = renderMap({
      markers: [{ id: "p", position: [0.5, 0.5], label: "Mar 2019", radius: 2, hitRadius: 7 }],
      getMarkerValue: () => 300,
      getMarkerDetail: () => <span>Istanbul 64%</span>,
    });
    fireEvent.focus(container.querySelector("circle.geo-marker")!);
    expect(tooltip().getByText("Mar 2019")).toBeTruthy();
    expect(tooltip().getByText("Istanbul 64%")).toBeTruthy();
  });
});
