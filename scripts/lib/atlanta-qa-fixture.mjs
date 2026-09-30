/**
 * Made-up Atlanta places for testing #293's "Check places" modal on a PR
 * database (seeded by scripts/seed-pr-fixture.mjs).
 *
 * Each case is one venue under a neighborhood node under the Atlanta root,
 * with coordinates chosen to land in exactly one of the situations
 * src/lib/geo/city-place-qa.ts distinguishes. The points are *computed* from
 * the committed src/data/geo/atlanta.topo.json (a point inside a named
 * polygon) instead of hand-typed, so a case can't drift out of its polygon
 * by a typo; src/lib/geo/atlanta-qa-fixture.test.ts runs every case through
 * the real detection code and fails if any stops producing what `expect`
 * says, so a change to the geometry or to atlanta-names.ts can't silently
 * turn this into a fixture that no longer covers what it claims to.
 *
 * Plain JS with no TS imports because the seed runs under bare `node` in CI.
 * The Atlanta root's id (701) is duplicated from city-config.ts for the same
 * reason; the test asserts they still match.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { feature } from "topojson-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** city-config.ts's Atlanta `rootId` — places under this id are "in Atlanta". */
export const ATLANTA_ROOT_ID = 701;
export const ATLANTA_ROOT_NAME = "Atlanta";

// Far from every Atlanta polygon: Savannah (a real coordinate in the wrong
// city), and Atlanta's own longitude with the sign flipped, which lands in
// Tibet, the classic geocoding/data-entry slip.
const SAVANNAH = [-81.0912, 32.0809];
const SIGN_FLIPPED = [84.388, 33.749];

/**
 * A mapping added "from the modal" ahead of time, so the Custom mappings list
 * has something in it and Remove can be tried: with it, "Atlanta Beltline
 * Trail" resolves to Inman Park and its place is fine; remove it and that
 * place shows up as "no matching polygon name".
 */
export const ATLANTA_QA_OVERRIDES = [
  { cityKey: "atlanta", root: "Atlanta", rawName: "atlanta beltline trail", geometryName: "Inman Park" },
];

/** Venue whose "wrong neighborhood" finding is pre-dismissed, so Dismissed
 * has something in it and Restore can be tried. */
export const ATLANTA_QA_DISMISSED_VENUE = "Krog Street Market";

/**
 * `expect` is what the detection returns with the overrides above applied:
 * a finding kind, or "none" when the place is fine or deliberately not
 * reported. `expectWithoutOverrides` is set where the override changes it.
 * `in` picks a point inside that polygon (`k` selects a different one, so
 * two venues in one polygon don't stack); `at` is a fixed point; neither
 * means the place was never geocoded.
 */
export const ATLANTA_QA_CASES = [
  // --- Fine: must NOT be reported -----------------------------------------
  {
    chain: ["Midtown"],
    venue: "High Museum of Art",
    in: "Midtown",
    expect: "none",
    why: "Control: the catalog name is a polygon and the point is inside it.",
  },
  {
    chain: ["Beltline"],
    venue: "Eastside Trail Entrance",
    in: "Inman Park",
    expect: "none",
    why: "Resolves through the static alias table (\"beltline\" -> Inman Park) and the point agrees.",
  },
  {
    chain: ["Atlanta Beltline Trail"],
    venue: "Trailhead Cafe",
    in: "Inman Park",
    k: 1,
    expect: "none",
    expectWithoutOverrides: "unmapped",
    why: "Fine only because of the seeded custom mapping; Remove it and this appears under \"No matching polygon name\".",
  },
  {
    chain: ["Uptown Atlanta", "Midtown"],
    venue: "Fox Theatre Box Office",
    in: "Midtown",
    k: 1,
    expect: "none",
    why: "Only the second name under the city is a polygon; every segment is tried, not just the first.",
  },
  // --- Wrong neighborhood -------------------------------------------------
  {
    chain: ["Cabbagetown"],
    venue: ATLANTA_QA_DISMISSED_VENUE,
    in: "Inman Park",
    k: 2,
    expect: "mismatch",
    why: "Declared Cabbagetown, point is in Inman Park. Pre-dismissed.",
  },
  {
    chain: ["Old Fourth Ward"],
    venue: "Ponce City Market",
    in: "Candler Park",
    expect: "mismatch",
    why: "Declared Old Fourth Ward, point is in Candler Park. Undismissed, for trying Dismiss.",
  },
  // --- Outside the city ---------------------------------------------------
  {
    chain: ["Downtown"],
    venue: "Centennial Olympic Park Kiosk",
    at: SIGN_FLIPPED,
    expect: "outside",
    why: "Longitude sign flipped: the point lands in no Atlanta polygon at all.",
  },
  {
    chain: ["Summerhill"],
    venue: "Old Stadium Lot",
    at: SAVANNAH,
    expect: "outside",
    why: "A real coordinate in the wrong city.",
  },
  // --- Spelling (same name once punctuation is ignored) --------------------
  {
    chain: ["Lindbergh Morosgo"],
    venue: "Lindbergh Plaza Cafe",
    in: "Lindbergh/Morosgo",
    expect: "spelling",
    why: "Polygon is \"Lindbergh/Morosgo\"; the catalog has a space where the slash is. The alias table only knows \"lindbergh\".",
  },
  {
    chain: ["Morningside Lenox Park"],
    venue: "Morningside Bakery",
    in: "Morningside/Lenox Park",
    expect: "spelling",
    why: "The alias table knows \"morningside-lenox park\" (hyphen), not this spelling.",
  },
  // --- No matching polygon name --------------------------------------------
  {
    chain: ["West Midtown Warehouse District"],
    venue: "Warehouse Coffee",
    in: "Home Park",
    expect: "unmapped",
    why: "A real area with no polygon of that name. One mapping should fix both venues here.",
  },
  {
    chain: ["West Midtown Warehouse District"],
    venue: "Warehouse Climbing Gym",
    in: "Home Park",
    k: 1,
    expect: "unmapped",
    why: "Second venue under the same unmapped name.",
  },
  // --- Deliberately not reported ------------------------------------------
  {
    chain: ["Briarcliff Woods"],
    venue: "Briarcliff Woods Trailhead",
    at: SAVANNAH,
    expect: "none",
    why: "Known gap (no polygon, see atlanta-names.ts) and the point is in no polygon either: nothing to compare.",
  },
  {
    chain: ["Midtown"],
    venue: "Pop-up Market (no address)",
    expect: "none",
    why: "Never geocoded: no coordinates, so it isn't checked and gets no dot on the map.",
  },
];

function loadAtlantaFeatures() {
  const filePath = path.join(__dirname, "..", "..", "src", "data", "geo", "atlanta.topo.json");
  const topo = JSON.parse(readFileSync(filePath, "utf8"));
  return feature(topo, topo.objects.atlanta).features;
}

// Every point of a coarse grid over the polygon's bounds that is really inside
// it, plus the centroid when that is inside (a concave shape can put it
// outside). A grid rather than the centroid alone so `k` can pick distinct
// points and two venues in one polygon don't sit on top of each other.
function interiorPoints(f) {
  const points = [];
  const centroid = d3.geoCentroid(f);
  if (d3.geoContains(f, centroid)) points.push(centroid);
  const [[x0, y0], [x1, y1]] = d3.geoBounds(f);
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const p = [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * j) / steps];
      if (d3.geoContains(f, p)) points.push(p);
    }
  }
  return points;
}

/**
 * The cases with coordinates resolved: `lng`/`lat` set for every geocoded
 * case, both null for the ungeocoded one. Throws (rather than seeding a
 * quietly wrong point) if a named polygon is missing or has no interior
 * point, since that means the geometry changed under this fixture.
 */
export function buildAtlantaQaFixture() {
  const features = loadAtlantaFeatures();
  const cases = ATLANTA_QA_CASES.map((c) => {
    let point = null;
    if (c.at) {
      point = c.at;
    } else if (c.in) {
      const f = features.find((x) => x.properties.name === c.in);
      if (!f) throw new Error(`Atlanta QA fixture: no polygon named "${c.in}" in atlanta.topo.json`);
      const points = interiorPoints(f);
      if (points.length === 0) throw new Error(`Atlanta QA fixture: found no interior point for "${c.in}"`);
      point = points[(c.k ?? 0) % points.length];
    }
    return { ...c, lng: point ? point[0] : null, lat: point ? point[1] : null };
  });
  return { rootId: ATLANTA_ROOT_ID, rootName: ATLANTA_ROOT_NAME, cases };
}
