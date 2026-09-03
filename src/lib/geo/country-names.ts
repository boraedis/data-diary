// A small, hand-maintained alias table from this app's own free-text
// place-catalog country names (see places.color's own comment in
// schema.ts — set only on top-level "country" places, entered by hand via
// the entry form's "+ New" flow, not from a controlled ISO list) to
// world-atlas's GeoJSON `properties.name` spelling — so a choropleth join
// by name doesn't silently drop a country just because "USA" isn't
// literally "United States of America". Deliberately not a full ISO-3166
// synonym table (that's a much bigger, mostly-unused list) — extend this
// only when a real country in the catalog doesn't match world-atlas's
// naming, not preemptively for every ISO member.
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  usa: "United States of America",
  "united states": "United States of America",
  us: "United States of America",
  uae: "United Arab Emirates",
  uk: "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  "northern ireland": "United Kingdom",
  "czech republic": "Czechia",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "south korea": "South Korea",
  "north korea": "North Korea",
  "ivory coast": "Côte d'Ivoire",
  eswatini: "eSwatini",
  swaziland: "eSwatini",
};

/** Normalizes a place-catalog country name to world-atlas's own GeoJSON
 * feature name, for joining visit data against map geometry by name. Case/
 * whitespace-insensitive on the lookup; a name with no known alias passes
 * through unchanged (the common case — most catalog country names already
 * match world-atlas's naming exactly, e.g. "France", "Japan"). */
export function normalizeCountryName(name: string): string {
  return COUNTRY_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}
