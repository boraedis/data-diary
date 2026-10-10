// Alias table(s) for the DC-metro city-heatmap group, covering its 3
// catalog roots and its 5 coordinate-resolved suburbs (#281). See
// city-config.ts on why DC-metro spans 3 places.namePath roots rather
// than one subtree. Same normalizeCountryName pattern as
// src/lib/geo/country-names.ts, keyed per root since Washington/
// Arlington/Alexandria are 3 independent GIS sources with independent
// naming quirks — a single flat table would risk a same-named
// neighborhood in two roots colliding.
//
// Built by diffing the real catalog neighborhood lists against the real
// geometry feature names (2026-09-08).

const WASHINGTON_NAME_ALIASES: Record<string, string> = {
  "mount vernon square": "Mount Vernon Square (neighborhood)",
  "national mall": "The National Mall",
  "u-street": "U-Street Corridor",
};

const ARLINGTON_NAME_ALIASES: Record<string, string> = {
  "ballston-virginia square": "Ballston - Virginia Square",
  clarendon: "Clarendon - Courthouse",
  "ronald reagan washington national airport": "Ronald Reagan Washington National Airport (DCA)",
  // Custis Trail / Mt Vernon Trail: both are linear trails in the
  // catalog, not areas — no matching polygon in this GIS layer (a trail
  // isn't a neighborhood), left unmapped rather than bucketed into
  // whichever neighborhood the trail happens to pass through.
};

// Alexandria's only catalog neighborhood ("Old Town") matches its GIS
// layer's Overlay_Name exactly — no aliases needed today. Function kept
// for symmetry with the other two roots and so a future Alexandria
// catalog entry has somewhere to add an alias without restructuring
// this file's shape.
const ALEXANDRIA_NAME_ALIASES: Record<string, string> = {};

// The suburban regions (#281) resolve by the town the catalog path names
// first, falling back to coordinates only when no segment names a region
// (see resolveCitySuburbFeature), so these tables decide where a place
// lands whether or not it is geocoded. Keys are the
// catalog spellings from the Virginia/Maryland entries listed on #281;
// values are Census place names from the region's own source file.
const FAIRFAX_COUNTY_NAME_ALIASES: Record<string, string> = {
  // The Census renamed the CDP when it was redrawn for 2020.
  "tysons corner": "Tysons",
};

// Both independent cities are one feature each, named "City of …" so it
// can't be mistaken for the county or for a Census place inside it.
const FAIRFAX_CITY_NAME_ALIASES: Record<string, string> = {
  fairfax: "City of Fairfax",
};

const FALLS_CHURCH_NAME_ALIASES: Record<string, string> = {
  "falls church": "City of Falls Church",
};

// "Chevy Chase" is deliberately unmapped: it's a town, a CDP and three
// numbered villages in the Census, and a bare catalog "Chevy Chase" can't
// say which. A geocoded place resolves by its point regardless.
const MONTGOMERY_COUNTY_NAME_ALIASES: Record<string, string> = {};

const PRINCE_GEORGES_COUNTY_NAME_ALIASES: Record<string, string> = {};

export type DcMetroRoot =
  | "Washington"
  | "Arlington"
  | "Alexandria"
  | "Fairfax County"
  | "Fairfax City"
  | "Falls Church"
  | "Montgomery County"
  | "Prince George's County";

const ALIASES_BY_ROOT: Record<DcMetroRoot, Record<string, string>> = {
  Washington: WASHINGTON_NAME_ALIASES,
  Arlington: ARLINGTON_NAME_ALIASES,
  Alexandria: ALEXANDRIA_NAME_ALIASES,
  "Fairfax County": FAIRFAX_COUNTY_NAME_ALIASES,
  "Fairfax City": FAIRFAX_CITY_NAME_ALIASES,
  "Falls Church": FALLS_CHURCH_NAME_ALIASES,
  "Montgomery County": MONTGOMERY_COUNTY_NAME_ALIASES,
  "Prince George's County": PRINCE_GEORGES_COUNTY_NAME_ALIASES,
};

/** Normalizes a place-catalog neighborhood name, scoped to one of
 * DC-metro's roots or suburbs, to that root's own geometry feature name in
 * dc-metro.topo.json. `root` must match the feature's own `root`
 * property so a name isn't accidentally resolved against the wrong
 * city's alias table. */
export function normalizeDcMetroName(root: DcMetroRoot, name: string): string {
  return ALIASES_BY_ROOT[root][name.trim().toLowerCase()] ?? name;
}
