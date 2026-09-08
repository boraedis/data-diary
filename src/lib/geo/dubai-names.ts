// Alias table from the place-catalog's Dubai neighborhood names to
// dubai.topo.json's own feature names (Dubai Municipality's official
// "community" boundary layer). Same normalizeCountryName pattern as
// src/lib/geo/country-names.ts.
//
// Built by diffing the real catalog neighborhood list against the real
// geometry feature names (2026-09-08) — and that diff turned up a real
// gap worth flagging, not just spelling noise: this municipality layer
// is drawn from older official "community" boundaries, and doesn't cover
// a lot of newer, real-estate-marketed development names that people
// actually enter in a personal catalog (Dubailand, Emirates Hills, The
// Greens, Motor City, Meadows, Meydan Heights, Victory Heights, Falcon
// City of Wonders, Internet City, Jumeirah Islands — none of these have
// a matching polygon in this layer at all, checked). That's roughly a
// third of the catalog's current Dubai neighborhoods with no possible
// alias — they'll render as "no data" until a better-covering geometry
// source is found, not a bug in this table.
//
// "Al Qouz Ind 1-4" (catalog) already match this layer's own naming
// exactly (no trailing period, unlike a first-pass read of this file
// that assumed one) — no alias needed for those, left out on purpose,
// not an oversight.
const DUBAI_NAME_ALIASES: Record<string, string> = {
  // "Dubai Investment Park" (catalog) is ambiguous against this layer,
  // which splits it into "Dubai Investment Park 1" and "...2" — left
  // unmapped rather than guessing which one.
};

/** Normalizes a place-catalog Dubai neighborhood ("community") name to
 * dubai.topo.json's own feature name. Case/whitespace-insensitive on the
 * lookup; a name with no known alias passes through unchanged. See this
 * file's own header comment for the real, still-open coverage gap for
 * several newer development names. */
export function normalizeDubaiName(name: string): string {
  return DUBAI_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}
