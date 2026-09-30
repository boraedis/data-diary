import { describe, expect, it } from "vitest";
import type { CityRootConfig } from "./city-config";
import {
  findCityPlaceQaFindings,
  parseCityPlaceQaKind,
  withCityNeighborhoodOverrides,
  type CityGeometryFeature,
  type CityPlaceQaPlace,
} from "./city-place-qa";

const ROOTS: CityRootConfig[] = [{ root: "Atlanta", rootId: 701, sourceFile: "atlanta.geojson" }];

// Axis-aligned squares stand in for real polygons: the module takes its
// point-in-polygon test as a parameter precisely so this can be checked
// without d3 or real geometry.
function square(name: string, x0: number, y0: number, x1: number, y1: number): CityGeometryFeature {
  return {
    type: "Feature",
    properties: { root: "Atlanta", name },
    geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
  };
}

const FEATURES = [square("Midtown", 0, 0, 10, 10), square("Inman Park", 20, 0, 30, 10), square("Morningside/Lenox Park", 40, 0, 50, 10)];

const inside = (f: CityGeometryFeature, [x, y]: [number, number]) => {
  const ring = (f.geometry as { coordinates: number[][][] }).coordinates[0];
  return x >= ring[0][0] && x <= ring[1][0] && y >= ring[0][1] && y <= ring[2][1];
};

const identity = (_root: string, name: string) => name;

function place(id: number, namePath: string, lng: number, lat: number, idPath = "701/9000"): CityPlaceQaPlace {
  return { id, name: namePath.split("/").pop()!, idPath, namePath, lng, lat };
}

const run = (places: CityPlaceQaPlace[], normalize = identity) =>
  findCityPlaceQaFindings(places, ROOTS, FEATURES, inside, normalize);

describe("findCityPlaceQaFindings", () => {
  it("reports nothing when the declared neighborhood contains the point", () => {
    expect(run([place(1, "Atlanta/Midtown/High Museum", 5, 5)])).toEqual([]);
  });

  it("flags a point in a different neighborhood than declared as a mismatch", () => {
    const [f] = run([place(1, "Atlanta/Midtown/High Museum", 25, 5)]);
    expect(f.kind).toBe("mismatch");
    expect(f.declared).toEqual({ root: "Atlanta", featureName: "Midtown" });
    expect(f.actual).toEqual({ root: "Atlanta", name: "Inman Park" });
  });

  it("flags a declared neighborhood whose point is in no polygon as outside", () => {
    const [f] = run([place(1, "Atlanta/Midtown/High Museum", 500, 500)]);
    expect(f.kind).toBe("outside");
    expect(f.actual).toBeNull();
  });

  it("calls a name that differs only in punctuation a spelling gap, with a ready alias", () => {
    const [f] = run([place(1, "Atlanta/Morningside-Lenox Park/Some Cafe", 45, 5)]);
    expect(f.kind).toBe("spelling");
    expect(f.suggestedAlias).toEqual({
      segment: "Morningside-Lenox Park",
      aliasKey: "morningside-lenox park",
      aliasValue: "Morningside/Lenox Park",
    });
  });

  it("does not treat a real typo or abbreviation as spelling", () => {
    const [f] = run([place(1, "Atlanta/Midtown Atl/Some Cafe", 5, 5)]);
    expect(f.kind).toBe("unmapped");
    expect(f.suggestedAlias).toBeNull();
  });

  it("stays quiet for a place with no declared neighborhood whose point is nowhere either", () => {
    expect(run([place(1, "Atlanta/Nowhere Land/Some Cafe", 500, 500)])).toEqual([]);
  });

  it("skips places outside the city's catalog roots entirely", () => {
    expect(run([place(1, "Paris/Le Marais/Cafe", 25, 5, "55/66")])).toEqual([]);
  });

  it("resolves through a supplied alias instead of flagging it", () => {
    const aliased = (_root: string, name: string) => (name === "Beltline" ? "Inman Park" : name);
    expect(run([place(1, "Atlanta/Beltline/Trail", 25, 5)], aliased)).toEqual([]);
  });
});

describe("withCityNeighborhoodOverrides", () => {
  const base = (_root: string, name: string) => (name.toLowerCase() === "beltline" ? "Inman Park" : name);

  it("returns the base function untouched when there are no overrides", () => {
    expect(withCityNeighborhoodOverrides(base, [])).toBe(base);
  });

  it("prefers an override, case- and whitespace-insensitively, over the static table", () => {
    const n = withCityNeighborhoodOverrides(base, [{ root: "Atlanta", rawName: "beltline", geometryName: "Midtown" }]);
    expect(n("Atlanta", "  BeltLine ")).toBe("Midtown");
  });

  it("falls through to the static table for names it has no override for", () => {
    const n = withCityNeighborhoodOverrides(base, [{ root: "Atlanta", rawName: "other", geometryName: "Midtown" }]);
    expect(n("Atlanta", "Beltline")).toBe("Inman Park");
  });

  it("scopes an override to its own root", () => {
    const n = withCityNeighborhoodOverrides(base, [{ root: "Washington", rawName: "downtown", geometryName: "Foggy Bottom" }]);
    expect(n("Arlington", "Downtown")).toBe("Downtown");
    expect(n("Washington", "Downtown")).toBe("Foggy Bottom");
  });
});

describe("parseCityPlaceQaKind", () => {
  it("accepts the four kinds and rejects anything else", () => {
    expect(parseCityPlaceQaKind("spelling")).toBe("spelling");
    expect(parseCityPlaceQaKind("bogus")).toBeNull();
    expect(parseCityPlaceQaKind(3)).toBeNull();
  });
});
