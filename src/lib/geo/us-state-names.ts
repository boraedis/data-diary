import statesTopoRaw from "us-atlas/states-10m.json";
import { normalizeCountryName } from "./country-names";

// Name-join layer for #287's US state choropleth — the state-level
// sibling of country-names.ts, and the same kind of arbitrary-depth
// resolution resolve-city-place.ts does for neighborhoods, just aimed at
// a different ancestor level.
//
// Read straight off us-atlas's own TopoJSON rather than a hand-typed list
// of 50 states: a TopoJSON object's `.geometries` carry `properties`
// without needing any arc resolution, so this is a cheap property read of
// the exact same file the chart component draws from — which is the
// point. The join target can't drift from the drawn geometry's naming,
// because it *is* the drawn geometry's naming.
type StatesTopology = {
  objects: { states: { geometries: { properties: { name: string } }[] } };
};

/** Every feature name us-atlas's states-10m.json actually contains — the
 * 50 states, DC, and the 5 territories it also ships (American Samoa,
 * Guam, the Northern Mariana Islands, Puerto Rico, the US Virgin
 * Islands). Deliberately the *full* set, not just the ones a given
 * projection can draw: resolution ("which state is this place in?") and
 * renderability ("can this projection place it?") are two different
 * questions, and the chart component owns the second one — see
 * us-state-visits-chart.tsx's own comment on geoAlbersUsa. Resolving a
 * territory here and letting the chart report it as off-map is what keeps
 * real logged days from silently vanishing. */
export const US_STATE_FEATURE_NAMES: ReadonlySet<string> = new Set(
  (statesTopoRaw as unknown as StatesTopology).objects.states.geometries.map((g) => g.properties.name),
);

// Same shape and same rule as country-names.ts's own table: this app's
// place catalog is hand-entered free text, not a controlled list, so a
// name-join needs a small alias table for the cases where the catalog's
// spelling and us-atlas's disagree. Extend it only when a state/territory
// that's really in the catalog fails to match, not preemptively for every
// abbreviation a US address could use.
//
// "Virgin Islands" is the one entry the current catalog actually needs
// (USA/Virgin Islands/Saint John/..., USA/Virgin Islands/Saint Thomas/...);
// the DC spellings are here because "Washington, D.C." is the far more
// natural thing to type than us-atlas's "District of Columbia", and
// getting DC wrong would be conspicuous in this particular dataset.
const US_STATE_NAME_ALIASES: Record<string, string> = {
  "virgin islands": "United States Virgin Islands",
  "us virgin islands": "United States Virgin Islands",
  "u.s. virgin islands": "United States Virgin Islands",
  usvi: "United States Virgin Islands",
  dc: "District of Columbia",
  "d.c.": "District of Columbia",
  "washington dc": "District of Columbia",
  "washington d.c.": "District of Columbia",
  "washington, dc": "District of Columbia",
  "washington, d.c.": "District of Columbia",
  "northern mariana islands": "Commonwealth of the Northern Mariana Islands",
};

/** Normalizes a place-catalog name to us-atlas's own feature naming, for
 * joining visit data against map geometry by name. Case/whitespace-
 * insensitive on the lookup; a name with no known alias passes through
 * unchanged (the common case — the catalog already spells almost every
 * state exactly the way us-atlas does). */
export function normalizeUsStateName(name: string): string {
  return US_STATE_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}

/**
 * Resolves a catalog place to the US state (or DC/territory) it sits in,
 * by walking its namePath — or null if it isn't in the US at all, or is
 * but matches no us-atlas feature name.
 *
 * **Not depth-assumed.** Every namePath segment after the root is checked
 * against us-atlas's own feature names, in root-to-leaf order, and the
 * first match wins — the same "check every segment, don't hardcode a
 * level" reasoning resolveCityFeatureName documents for neighborhoods.
 * The current catalog does happen to put every state at depth 2
 * (USA/Georgia/Atlanta/...), but nothing in the schema enforces that:
 * `places.subregionName` is free text ("State", "City", "Location",
 * "Nieghborhood" — all real values in this database, typo included), so
 * "the second segment is the state" is a fact about today's data, not an
 * invariant to build on.
 *
 * Root-to-leaf order is what makes first-match-wins safe here, and it's
 * load-bearing rather than incidental: several state names recur further
 * down the hierarchy as city and neighborhood names (Washington the city
 * inside DC, New York the city inside New York state). Because a real
 * state segment is always *shallower* than any place inside it, scanning
 * outward-in reaches the state first and a same-named descendant can
 * never shadow it.
 *
 * The root is identified by namePath's own first segment run through
 * normalizeCountryName — the same country resolution getCountryVisitData
 * already does — rather than by a hardcoded root id the way
 * city-config.ts's `rootId` has to be. That indirection exists there only
 * because a city root's name can legitimately recur mid-path (Dubai the
 * emirate containing Dubai the city); segment 0 is unambiguously the root
 * by construction, so there's nothing to disambiguate at this level.
 */
export function resolveUsStateName(namePath: string | null | undefined): string | null {
  if (!namePath) return null;
  const segments = namePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  if (normalizeCountryName(segments[0]) !== "United States of America") return null;
  for (const segment of segments.slice(1)) {
    const normalized = normalizeUsStateName(segment);
    if (US_STATE_FEATURE_NAMES.has(normalized)) return normalized;
  }
  // In the US, but under no recognizable state — a real gap worth leaving
  // visible (an unmapped territory, or a place filed directly under USA
  // with no state level), not something to guess at.
  return null;
}
