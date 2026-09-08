// Alias table from the place-catalog's NYC neighborhood names to
// nyc.topo.json's own feature names (NYU Furman Center's neighborhood
// tabulation, the standard published NYC neighborhood-boundary dataset).
// Same normalizeCountryName pattern as src/lib/geo/country-names.ts.
//
// NYC's catalog hierarchy is one level deeper than every other #177 city
// (places.namePath goes root -> borough -> neighborhood, not root ->
// neighborhood directly) — nyc.topo.json's own features carry a `group`
// property (the borough) alongside `name` for exactly that reason. This
// table only normalizes the neighborhood-name segment; matching the
// right borough is the consuming chart's job, not this file's.
//
// Built by diffing the real catalog neighborhood list (all 4 boroughs
// currently in use — Brooklyn, Manhattan, Queens, Staten Island) against
// the real geometry feature names (2026-09-08).
const NYC_NAME_ALIASES: Record<string, string> = {
  "gramercy park": "Gramercy",
};

/** Normalizes a place-catalog NYC neighborhood name to nyc.topo.json's
 * own feature name. Case/whitespace-insensitive on the lookup; a name
 * with no known alias passes through unchanged (the common case — every
 * current catalog neighborhood but one already matches this dataset's
 * naming exactly). */
export function normalizeNycName(name: string): string {
  return NYC_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}
