import * as d3 from "d3";
import { feature } from "topojson-client";
import { describe, expect, it } from "vitest";
import dcMetroTopo from "@/data/geo/dc-metro.topo.json";
import { CITIES, type CitySuburbConfig } from "./city-config";
import type { CityGeometryFeature } from "./city-place-qa";
import { resolveCitySuburbFeature, type CitySuburbFeature } from "./resolve-city-place";

const VIRGINIA = 1828;
const MARYLAND = 1392;

// Two square "places" inside a square "county", plus the county's
// remainder, all in plain lon/lat with a planar point test — the rules are
// what's under test here, not the geometry.
function square(root: string, name: string, [x0, y0, x1, y1]: number[], remainder = false): CitySuburbFeature {
  return {
    root,
    name,
    remainder,
    bounds: [
      [x0, y0],
      [x1, y1],
    ],
    contains: ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
  };
}

const SUBURBS: CitySuburbConfig[] = [
  { root: "County A", stateRootId: VIRGINIA, countyFips: "51000", sourceFile: "a.geojson" },
  { root: "County B", stateRootId: MARYLAND, countyFips: "24000", sourceFile: "b.geojson" },
];
// Listed remainder-first, as the real source files are, so the "places
// before the remainder" rule is exercised rather than satisfied by order.
const FEATURES: CitySuburbFeature[] = [
  square("County A", "Rest of County A", [0, 0, 10, 10], true),
  square("County A", "Townville", [1, 1, 3, 3]),
  square("County A", "Hamlet", [5, 5, 7, 7]),
  square("County B", "Rest of County B", [20, 0, 30, 10], true),
  square("County B", "Townville", [21, 1, 23, 3]),
];
const identity = (_root: string, name: string) => name;

function place(idPath: string, namePath: string, lat: number | null = null, lng: number | null = null) {
  return { idPath, namePath, lat, lng };
}

describe("resolveCitySuburbFeature", () => {
  it("with no town name to go on, credits a geocoded place to the polygon containing it, ahead of the county remainder", () => {
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Somewhere/", 2, 2), SUBURBS, FEATURES, identity)).toEqual({
      root: "County A",
      featureName: "Townville",
    });
  });

  it("falls to the remainder for a point in the county between places", () => {
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Somewhere/", 9, 9), SUBURBS, FEATURES, identity)).toEqual({
      root: "County A",
      featureName: "Rest of County A",
    });
  });

  it("trusts the catalog's town over the point, so a wrong coordinate stays visible", () => {
    // Filed under Hamlet, geocoded inside Townville: credited to Hamlet. The
    // dot lands in Townville on the map, against Hamlet's colour.
    expect(resolveCitySuburbFeature(place("1/1828/9/10/", "USA/Virginia/Hamlet/Cafe/", 2, 2), SUBURBS, FEATURES, identity)).toEqual({
      root: "County A",
      featureName: "Hamlet",
    });
  });

  it("credits a named town even when the point is outside every region", () => {
    expect(resolveCitySuburbFeature(place("1/1828/9/10/", "USA/Virginia/Hamlet/Cafe/", 50, 50), SUBURBS, FEATURES, identity)).toEqual({
      root: "County A",
      featureName: "Hamlet",
    });
  });

  it("falls back to the point when no segment names a feature, and ignores a point outside every region", () => {
    expect(resolveCitySuburbFeature(place("1/1828/9/10/", "USA/Virginia/Elsewhere/Cafe/", 2, 2), SUBURBS, FEATURES, identity)).toEqual({
      root: "County A",
      featureName: "Townville",
    });
    expect(resolveCitySuburbFeature(place("1/1828/9/10/", "USA/Virginia/Elsewhere/Cafe/", 50, 50), SUBURBS, FEATURES, identity)).toBeNull();
  });

  it("lets the point choose between regions that share a name", () => {
    const both: CitySuburbConfig[] = [
      { root: "County A", stateRootId: VIRGINIA, countyFips: "51000", sourceFile: "a.geojson" },
      { root: "County C", stateRootId: VIRGINIA, countyFips: "51001", sourceFile: "c.geojson" },
    ];
    const shared = [square("County A", "Twin", [0, 0, 2, 2]), square("County C", "Twin", [10, 0, 12, 2])];
    const path = place("1/1828/9/", "USA/Virginia/Twin/", 1, 11);
    expect(resolveCitySuburbFeature(path, both, shared, identity)).toEqual({ root: "County C", featureName: "Twin" });
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Twin/"), both, shared, identity)).toEqual({
      root: "County A",
      featureName: "Twin",
    });
  });

  it("only considers regions in the state the catalog files the place under", () => {
    // Inside County B's Townville, but filed under Virginia: a bad geocode
    // can't pull a place across state lines onto the map.
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Somewhere/", 2, 22), SUBURBS, FEATURES, identity)).toBeNull();
    expect(resolveCitySuburbFeature(place("1/2/9/", "USA/Ohio/Somewhere/", 2, 2), SUBURBS, FEATURES, identity)).toBeNull();
  });

  it("matches an ungeocoded place by the catalog's town name, within its own state only", () => {
    expect(resolveCitySuburbFeature(place("1/1392/9/10/", "USA/Maryland/Townville/Cafe/"), SUBURBS, FEATURES, identity)).toEqual({
      root: "County B",
      featureName: "Townville",
    });
    expect(resolveCitySuburbFeature(place("1/1828/9/10/", "USA/Virginia/Townville/Cafe/"), SUBURBS, FEATURES, identity)).toEqual({
      root: "County A",
      featureName: "Townville",
    });
  });

  it("applies normalize to the name fallback but never matches a remainder by name", () => {
    const normalize = (_root: string, name: string) => (name === "Old Townville" ? "Townville" : name);
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Old Townville/"), SUBURBS, FEATURES, normalize)).toEqual({
      root: "County A",
      featureName: "Townville",
    });
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Rest of County A/"), SUBURBS, FEATURES, identity)).toBeNull();
  });

  it("does match a remainder when an alias or QA override points a name at it", () => {
    // The place check's "Map name" saves exactly this kind of override.
    const override = (root: string, name: string) => (root === "County A" && name === "Hamlet" ? "Rest of County A" : name);
    expect(resolveCitySuburbFeature(place("1/1828/9/", "USA/Virginia/Hamlet/Cafe/", 2, 2), SUBURBS, FEATURES, override)).toEqual({
      root: "County A",
      featureName: "Rest of County A",
    });
  });
});

// The same rules against the committed geometry, at points whose answer is
// known. This is what catches a winding mistake (every polygon "contains"
// the whole globe) or a naming change in a rebuilt source file.
describe("dc-metro suburbs geometry", () => {
  const topo = dcMetroTopo as unknown as Parameters<typeof feature>[0];
  const all = (
    feature(topo, (topo as unknown as { objects: Record<string, never> }).objects["dc-metro"]) as unknown as {
      features: CityGeometryFeature[];
    }
  ).features;
  const suburbs = CITIES["dc-metro"].suburbs!;
  const suburbRoots = new Set(suburbs.map((s) => s.root));
  const features: CitySuburbFeature[] = all
    .filter((f) => suburbRoots.has(f.properties.root))
    .map((f) => ({
      root: f.properties.root,
      name: f.properties.name,
      remainder: f.properties.remainder === true,
      contains: (point) => d3.geoContains(f, point),
      bounds: d3.geoBounds(f),
    }));

  const cases: [string, number, number, number, string, string][] = [
    ["Reston Town Center", VIRGINIA, 38.9586, -77.3586, "Fairfax County", "Reston"],
    ["Tysons Corner Center", VIRGINIA, 38.9177, -77.2219, "Fairfax County", "Tysons"],
    ["Fairfax City Hall", VIRGINIA, 38.8462, -77.3064, "Fairfax City", "City of Fairfax"],
    ["Falls Church City Hall", VIRGINIA, 38.8823, -77.1711, "Falls Church", "City of Falls Church"],
    ["Bethesda Metro", MARYLAND, 38.9847, -77.0947, "Montgomery County", "Bethesda"],
    ["Downtown Silver Spring", MARYLAND, 38.9967, -77.0262, "Montgomery County", "Silver Spring"],
    ["UMD College Park", MARYLAND, 38.9869, -76.9426, "Prince George's County", "College Park"],
    ["Boyds (no CDP)", MARYLAND, 39.1832, -77.3127, "Montgomery County", "Rest of Montgomery County"],
  ];

  it.each(cases)("%s", (_label, stateRootId, lat, lng, root, featureName) => {
    expect(
      resolveCitySuburbFeature(place(`1/${stateRootId}/9/`, "USA/x/y/", lat, lng), suburbs, features, CITIES["dc-metro"].normalize),
    ).toEqual({ root, featureName });
  });

  it("leaves a point outside the five regions unresolved", () => {
    // Downtown Leesburg, Loudoun County.
    expect(resolveCitySuburbFeature(place(`1/${VIRGINIA}/9/`, "USA/x/y/", 39.1157, -77.5636), suburbs, features, CITIES["dc-metro"].normalize)).toBeNull();
  });

  it("doesn't let Fairfax County's polygon swallow the independent cities inside it", () => {
    const county = features.find((f) => f.remainder && f.root === "Fairfax County")!;
    expect(county.contains([-77.3064, 38.8462])).toBe(false);
    expect(county.contains([-77.1711, 38.8823])).toBe(false);
  });
});
