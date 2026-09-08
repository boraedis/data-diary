// Alias table from the place-catalog's Istanbul district names to
// istanbul.topo.json's own feature names (OpenStreetMap's admin_level=6
// district boundaries, pulled fresh via Overpass — see that file's own
// header comment on why this replaced legacy's raw Nominatim scrape).
// Same normalizeCountryName pattern as src/lib/geo/country-names.ts.
//
// Built by diffing the real catalog district list against OSM's official
// Turkish spelling (2026-09-08). The catalog entries below were typed
// without Turkish diacritics; OSM's `name` property uses proper Turkish
// orthography.
const ISTANBUL_NAME_ALIASES: Record<string, string> = {
  besiktas: "Beşiktaş",
  kadikoy: "Kadıköy",
};

/** Normalizes a place-catalog Istanbul district name to
 * istanbul.topo.json's own feature name. Case/whitespace-insensitive on
 * the lookup; a name with no known alias passes through unchanged (most
 * catalog entries — Arnavutköy, Beyoğlu, Eyüpsultan, Fatih,
 * Küçükçekmece, Sarıyer, Çekmeköy — were already entered with correct
 * Turkish spelling and match OSM's naming exactly). */
export function normalizeIstanbulName(name: string): string {
  return ISTANBUL_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}
