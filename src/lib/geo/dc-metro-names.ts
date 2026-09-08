// Alias table(s) for the DC-metro city-heatmap group, covering all 3
// catalog roots that make it up (see src/data/geo/dc-metro.topo.json's
// own header comment on why DC-metro spans 3 places.namePath roots, not
// one subtree). Same normalizeCountryName pattern as
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

export type DcMetroRoot = "Washington" | "Arlington" | "Alexandria";

const ALIASES_BY_ROOT: Record<DcMetroRoot, Record<string, string>> = {
  Washington: WASHINGTON_NAME_ALIASES,
  Arlington: ARLINGTON_NAME_ALIASES,
  Alexandria: ALEXANDRIA_NAME_ALIASES,
};

/** Normalizes a place-catalog neighborhood name, scoped to one of
 * DC-metro's 3 catalog roots, to that root's own geometry feature name in
 * dc-metro.topo.json. `root` must match the feature's own `root`
 * property so a name isn't accidentally resolved against the wrong
 * city's alias table. */
export function normalizeDcMetroName(root: DcMetroRoot, name: string): string {
  return ALIASES_BY_ROOT[root][name.trim().toLowerCase()] ?? name;
}
