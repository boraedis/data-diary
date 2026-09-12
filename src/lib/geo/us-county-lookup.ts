import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import countiesTopoRaw from "us-atlas/counties-10m.json";
import { US_STATE_FIPS_BY_NAME } from "./us-state-names";

/**
 * Name -> FIPS resolution for US counties (#363), for turning unlogged
 * travel's legacy `"CountyName__ST"` keys into the FIPS codes this app
 * keys counties by everywhere else.
 *
 * Distinct from `us-counties.ts` next door, which resolves a *point* to a
 * county by geometry. This resolves a *name*, which is a different and
 * strictly worse problem — hence everything below. Nothing in the running
 * app should use this: a name-join is the thing #107 deliberately avoided
 * for real day data. It exists for one-time imports of hand-written lists
 * that carry no coordinates, where the alternative is not importing them.
 *
 * Server/script-side only — it reads the same ~842KB county topology
 * `us-counties.ts` does.
 */

type CountyProperties = { name: string };

const countiesTopology = countiesTopoRaw as unknown as Topology<{
  counties: GeometryCollection<CountyProperties>;
}>;

/**
 * Two-letter postal abbreviation -> us-atlas's own state feature name.
 *
 * Deliberately maps to the *name*, letting `US_STATE_FIPS_BY_NAME` supply
 * the code, rather than hard-coding 56 FIPS numbers here. Two reasons: the
 * FIPS list already exists, read straight off the same file the maps draw
 * from (see us-state-names.ts's own comment on why that matters); and a
 * typo in this table then fails loudly at lookup time instead of silently
 * resolving to some other state's counties, which a mistyped numeric code
 * would do.
 *
 * Includes the five territories us-atlas ships. They have no counties in
 * the lower-48 sense and no legacy travel entry will name one, but
 * omitting them would make an unexpected key look like a bad abbreviation
 * rather than what it is.
 */
const STATE_NAME_BY_POSTAL: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  AS: "American Samoa",
  GU: "Guam",
  MP: "Commonwealth of the Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "United States Virgin Islands",
};

/** The postal codes this module understands — exported so a seed script
 * can report an unknown one as a bad key rather than a missing county. */
export const KNOWN_POSTAL_CODES: ReadonlySet<string> = new Set(Object.keys(STATE_NAME_BY_POSTAL));

/**
 * Suffixes us-atlas leaves *off* its county names but a hand-written list
 * is likely to include.
 *
 * us-atlas names counties bare — "Fulton", not "Fulton County" — and the
 * correct suffix isn't uniform anyway: Louisiana has parishes, Alaska has
 * boroughs and census areas, and Virginia's independent cities aren't
 * counties at all (see `UsCounty.name`'s comment in us-counties.ts).
 * Stripping them from *both* sides of the comparison means a list can
 * write "Orleans Parish" or "Orleans" and land on the same place.
 *
 * Ordered longest-first so "city and borough" is consumed before
 * "borough" can take half of it.
 */
const COUNTY_SUFFIXES = [
  "city and borough",
  "census area",
  "municipality",
  "borough",
  "parish",
  "county",
] as const;

/**
 * Reduces a county name to a comparison key.
 *
 * - Case- and whitespace-insensitive.
 * - "St." / "Ste." expand to "saint" / "sainte", so "St. Louis" and
 *   "Saint Louis" agree. us-atlas uses the abbreviated form; hand-written
 *   lists use both, inconsistently, often within the same list.
 * - Punctuation is dropped, so "Prince George's" matches "Prince Georges"
 *   and "O'Brien" matches "OBrien" — apostrophes are the single most
 *   common transcription difference in US county names.
 * - A trailing type suffix is removed, per COUNTY_SUFFIXES above.
 *
 * Note what is deliberately *not* normalized: "city". Virginia's
 * independent cities are distinct entities from the counties they share a
 * name with, so collapsing "Richmond city" into "Richmond" would merge two
 * different FIPS codes rather than reconcile a spelling. Those cases are
 * reported as ambiguous instead — see `resolveCountyByName`.
 */
export function countyNameKey(name: string): string {
  let key = name
    .toLowerCase()
    .replace(/\bste\.\s*/g, "sainte ")
    .replace(/\bst\.\s*/g, "saint ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const suffix of COUNTY_SUFFIXES) {
    if (key.endsWith(` ${suffix}`)) {
      key = key.slice(0, -(suffix.length + 1)).trim();
      break;
    }
  }
  return key;
}

export type CountyLookupResult =
  | { kind: "match"; fips: string; name: string }
  /** The state resolved, but no county in it matched the name. */
  | { kind: "no-county" }
  /** The postal abbreviation isn't one of the 56 us-atlas ships. */
  | { kind: "unknown-state" }
  /**
   * The name matches more than one county in that state, and the input
   * carries nothing to break the tie.
   *
   * This is not a hypothetical: us-atlas has exactly six such names, all
   * of them an independent city sharing a bare name with the county
   * around it — Baltimore (MD), St. Louis (MO), and Virginia's Richmond,
   * Franklin, Roanoke and Fairfax. A `"Richmond__VA"` key genuinely does
   * not say which of `51159` and `51760` was meant, so guessing would
   * silently attach travel to the wrong polygon. The candidates come back
   * so a caller can report them and let a human decide.
   */
  | { kind: "ambiguous"; candidates: { fips: string; name: string }[] };

let cachedByStateFips: Map<string, { fips: string; name: string }[]> | null = null;

/** Decoded once per process on first use, like `us-counties.ts` — a seed
 * run resolving 323 names shouldn't re-decode the topology 323 times. */
function countiesByStateFips() {
  if (cachedByStateFips) return cachedByStateFips;
  const byState = new Map<string, { fips: string; name: string }[]>();
  for (const f of feature(countiesTopology, countiesTopology.objects.counties).features) {
    const fips = String(f.id);
    const stateFips = fips.slice(0, 2);
    if (!byState.has(stateFips)) byState.set(stateFips, []);
    byState.get(stateFips)!.push({ fips, name: f.properties.name });
  }
  cachedByStateFips = byState;
  return byState;
}

/**
 * Resolves a county name plus a two-letter postal abbreviation to its
 * FIPS code — the `"CountyName__ST"` half of #363's seed.
 *
 * Scoped to the named state rather than searching nationwide, which is
 * the whole reason the postal code has to be part of the key: county
 * names repeat heavily across states (Lake County exists in a dozen), and
 * a nationwide name search would be ambiguous for hundreds of names
 * rather than six.
 *
 * Never guesses. Every outcome other than a single unambiguous match is
 * reported as its own kind, so a seed run can list what it couldn't place
 * instead of dropping it — a county silently lost at import is invisible
 * forever afterwards.
 */
export function resolveCountyByName(countyName: string, postalCode: string): CountyLookupResult {
  const stateName = STATE_NAME_BY_POSTAL[postalCode.trim().toUpperCase()];
  if (!stateName) return { kind: "unknown-state" };
  const stateFips = US_STATE_FIPS_BY_NAME.get(stateName);
  if (!stateFips) return { kind: "unknown-state" };

  const key = countyNameKey(countyName);
  const matches = (countiesByStateFips().get(stateFips) ?? []).filter((c) => countyNameKey(c.name) === key);

  if (matches.length === 1) return { kind: "match", fips: matches[0].fips, name: matches[0].name };
  if (matches.length === 0) return { kind: "no-county" };
  return { kind: "ambiguous", candidates: matches };
}

/** Splits a legacy `"CountyName__ST"` key into its two halves, or null if
 * it isn't in that shape. Separate from resolution so a malformed key is
 * distinguishable from an unresolvable one in a seed report. */
export function parseLegacyCountyKey(key: string): { countyName: string; postalCode: string } | null {
  const parts = key.split("__");
  if (parts.length !== 2) return null;
  const [countyName, postalCode] = parts.map((p) => p.trim());
  if (!countyName || !postalCode) return null;
  return { countyName, postalCode };
}
