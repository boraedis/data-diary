// Alias table from the place-catalog's Istanbul names to
// istanbul.topo.json's own feature names. The geometry is the city's
// mahalles (neighborhoods, OpenStreetMap admin_level=8), pulled via
// Overpass by scripts/geo-fetch-istanbul-mahalles.mjs, with the "Mahallesi"
// suffix dropped and a name that repeats across districts written
// "Name (District)". It used to be the 39 districts (ilçes), which is why
// the first two entries below are *district* spellings: they are no longer
// features, but resolveCityFeatureName normalizes the district segment too
// when it builds a "Name (District)" lookup for the mahalle under it.
// Same normalizeCountryName pattern as src/lib/geo/country-names.ts.
//
// Built by diffing the real catalog list against the geometry names
// (2026-10-09). Catalog entries typed without Turkish diacritics get an
// alias; the rest (Karaburun, Bebek, Emirgan, Şahkulu...) already match
// OSM's spelling exactly.
const ISTANBUL_NAME_ALIASES: Record<string, string> = {
  // Districts, typed without diacritics.
  besiktas: "Beşiktaş",
  kadikoy: "Kadıköy",
  // Neighborhoods the catalog spells or splits differently from OSM.
  "hoca paşa": "Hocapaşa",
  "rumeli kavağı": "Rumelikavağı",
  // Sultanahmet is the old-city area around the Blue Mosque and Hagia
  // Sophia, not a mahalle of its own any more: the square and Hagia Sophia
  // both fall in Cankurtaran.
  sultanahmet: "Cankurtaran",
};

/** Normalizes a place-catalog Istanbul name to istanbul.topo.json's own
 * feature name. Case/whitespace-insensitive on the lookup; a name with no
 * known alias passes through unchanged. */
export function normalizeIstanbulName(name: string): string {
  return ISTANBUL_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}
