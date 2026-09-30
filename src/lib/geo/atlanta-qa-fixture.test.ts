import * as d3 from "d3";
import { feature } from "topojson-client";
import { describe, expect, it } from "vitest";
import atlantaTopo from "@/data/geo/atlanta.topo.json";
import {
  ATLANTA_QA_CASES,
  ATLANTA_QA_OVERRIDES,
  ATLANTA_ROOT_ID,
  ATLANTA_ROOT_NAME,
  buildAtlantaQaFixture,
} from "../../../scripts/lib/atlanta-qa-fixture.mjs";
import { CITIES } from "./city-config";
import {
  findCityPlaceQaFindings,
  withCityNeighborhoodOverrides,
  type CityGeometryFeature,
  type CityPlaceQaPlace,
} from "./city-place-qa";

// The PR-database fixture for #293's modal (scripts/lib/atlanta-qa-fixture.mjs)
// is only useful while every case still produces the finding it claims to.
// This runs each one through the real detection code against the real Atlanta
// geometry, so a change to the polygons or to atlanta-names.ts that quietly
// breaks a case fails here instead of surfacing as a confusing modal later.

const features = feature(
  atlantaTopo as never,
  (atlantaTopo as unknown as { objects: { atlanta: never } }).objects.atlanta,
) as unknown as { features: CityGeometryFeature[] };

const { cases } = buildAtlantaQaFixture();

// Mirrors how the seed builds the tree: Fixtureland (id 1) > Atlanta (701) >
// the neighborhood chain > the venue. Only the root's position in idPath and
// the names after it matter to the resolver.
function toPlace(c: (typeof cases)[number], index: number): CityPlaceQaPlace {
  const id = 1000 + index;
  return {
    id,
    name: c.venue,
    idPath: `1/${ATLANTA_ROOT_ID}/${id}/`,
    namePath: `Fixtureland/${ATLANTA_ROOT_NAME}/${c.chain.join("/")}/${c.venue}/`,
    lng: c.lng as number,
    lat: c.lat as number,
  };
}

function kindsByVenue(overrides: typeof ATLANTA_QA_OVERRIDES) {
  const geocoded = cases.map((c, i) => ({ c, place: toPlace(c, i) })).filter(({ c }) => c.lng !== null && c.lat !== null);
  const findings = findCityPlaceQaFindings(
    geocoded.map((g) => g.place),
    CITIES.atlanta.sources,
    features.features,
    (f, point) => d3.geoContains(f, point),
    withCityNeighborhoodOverrides(CITIES.atlanta.normalize, overrides),
  );
  const byId = new Map(findings.map((f) => [f.placeId, f.kind]));
  return new Map(geocoded.map(({ c, place }) => [c.venue, byId.get(place.id) ?? "none"]));
}

describe("Atlanta QA fixture", () => {
  it("hardcodes the same root id city-config.ts uses for Atlanta", () => {
    expect(CITIES.atlanta.sources).toEqual([expect.objectContaining({ root: ATLANTA_ROOT_NAME, rootId: ATLANTA_ROOT_ID })]);
  });

  it("produces exactly the finding each case declares, with its seeded mapping applied", () => {
    const kinds = kindsByVenue(ATLANTA_QA_OVERRIDES);
    for (const c of ATLANTA_QA_CASES) {
      const got = kinds.get(c.venue);
      if (got === undefined) continue; // the ungeocoded case isn't checked at all
      expect(got, `${c.venue}: ${c.why}`).toBe(c.expect);
    }
  });

  it("changes only the cases that depend on the seeded mapping when it is removed", () => {
    const withOverrides = kindsByVenue(ATLANTA_QA_OVERRIDES);
    const without = kindsByVenue([]);
    const changed = [...without].filter(([venue, kind]) => kind !== withOverrides.get(venue)).map(([venue]) => venue);
    const expected = ATLANTA_QA_CASES.filter((c) => "expectWithoutOverrides" in c).map((c) => c.venue);
    expect(changed.sort()).toEqual(expected.sort());
    for (const c of ATLANTA_QA_CASES) {
      if ("expectWithoutOverrides" in c) expect(without.get(c.venue), c.venue).toBe(c.expectWithoutOverrides);
    }
  });

  it("covers every kind of finding, plus places that must not be reported", () => {
    const declared = new Set(ATLANTA_QA_CASES.map((c) => c.expect));
    for (const kind of ["mismatch", "outside", "spelling", "unmapped", "none"]) expect(declared).toContain(kind);
  });

  it("leaves exactly one case ungeocoded", () => {
    expect(cases.filter((c) => c.lng === null || c.lat === null)).toHaveLength(1);
  });
});
