// Alias table from this app's own place-catalog neighborhood names (see
// places.namePath) to the exact `properties.name` values in
// src/data/geo/atlanta.topo.json (sourced from Atlanta's official NPU/
// neighborhood-boundary GIS layer). Same pattern as
// src/lib/geo/country-names.ts's normalizeCountryName, one city at a
// time — see that file's own comment for why this isn't a bigger,
// speculative table.
//
// Built by diffing the real catalog neighborhood list against the real
// geometry feature names (2026-09-08), not carried over from legacy's
// `atlanta_heatmap.js` renames dict unmodified — that dict mixed
// geometry-side and catalog-side collapsing in one direction-ambiguous
// object; this table is one direction only (catalog name -> geometry
// name) and was re-verified against the actual GIS NAME field.
const ATLANTA_NAME_ALIASES: Record<string, string> = {
  // Legacy's own choice when a catalog neighborhood has no dedicated
  // polygon in this GIS layer — bucketed into the nearest/containing
  // official neighborhood rather than left unmapped. Kept for
  // continuity; revisit if a future GIS revision adds a real polygon.
  bankhead: "Historic Westin Heights/Bankhead",
  beltline: "Inman Park",
  "little five points": "Candler Park",
  "tech square": "Midtown",
  // Real spelling/formatting mismatches between the catalog entry and
  // the GIS NAME field.
  "downtown atlanta": "Downtown",
  lindbergh: "Lindbergh/Morosgo",
  "marrieta st artery": "Marietta Street Artery",
  "midtown atlanta": "Midtown",
  "morningside-lenox park": "Morningside/Lenox Park",
  "summer hill": "Summerhill",
  // This GIS layer actually has three separate Wildwood polygons
  // (NPU-C, NPU-H, and a plain "Wildwood Forest") — catalog entries
  // don't distinguish which. Matches legacy's own pick (NPU-C); a
  // genuinely ambiguous case, not a confirmed correct match.
  wildwood: "Wildwood (NPU-C)",
  // Briarcliff Woods: no matching polygon in this GIS layer at all
  // (checked, not just missed) — intentionally left unmapped rather
  // than guessing. Renders as "no data" until/unless it's confirmed to
  // exist under a different name.
};

/** Normalizes a place-catalog Atlanta neighborhood name to
 * atlanta.topo.json's own feature name, for joining visit data against
 * map geometry by name. Case/whitespace-insensitive on the lookup; a
 * name with no known alias passes through unchanged (the common case —
 * most catalog neighborhood names already match the GIS layer's naming
 * exactly, e.g. "Cabbagetown", "Old Fourth Ward"). */
export function normalizeAtlantaName(name: string): string {
  return ATLANTA_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}
