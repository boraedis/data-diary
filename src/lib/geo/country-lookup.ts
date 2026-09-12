import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopoRaw from "world-atlas/countries-110m.json";
import { normalizeCountryName } from "./country-names";

/**
 * Name -> code resolution for countries (#363), the world half of the
 * unlogged-travel seed and the lookup the manage surface's country picker
 * (#367) resolves against.
 *
 * **What a country's code is here.** world-atlas's `countries-110m.json`
 * carries the ISO 3166-1 *numeric* code as each feature's `id`, as a
 * string — `"840"` for the USA, `"124"` for Canada. Measured on the file
 * this app actually ships: 177 features, 174 with an id, all 174 unique
 * and all matching `/^[0-9]{1,3}$/`.
 *
 * **The three without one.** `N. Cyprus`, `Somaliland` and `Kosovo` have
 * no `id` at all — partially-recognized territories with no ISO numeric
 * code to carry. (Not a resolution artifact: `countries-50m` has the same
 * problem, 5 of 241.) A strict ISO key would make them unrepresentable,
 * which for Kosovo in particular is a real gap rather than a theoretical
 * one. So the code falls back to the feature's own name — which is not an
 * invention here but exactly the key `InteractiveGeo` already uses
 * internally (`String(f.id ?? getLabel(f))`), so the join stays one rule
 * rather than two that can drift apart.
 *
 * Note this is deliberately *not* how `/charts/world` joins its day
 * counts. That goes through `normalizeCountryName` because the place
 * catalog is free-text entered by hand, so name reconciliation is
 * unavoidable there. Unlogged travel is a controlled list, so it keys off
 * the code and only uses the alias table to *find* the feature in the
 * first place — the stored value is the code, not the name.
 */

type CountryProperties = { name: string };

const worldTopology = worldTopoRaw as unknown as Topology<{
  countries: GeometryCollection<CountryProperties>;
}>;

export type CountryFeatureRef = {
  /** What goes in `unlogged_travel.code` — see this module's comment. */
  code: string;
  /** world-atlas's own feature name, for display. */
  name: string;
  /** Whether `code` is a real ISO 3166-1 numeric code or the name
   * fallback. Exposed so a seed report or an admin UI can say so rather
   * than presenting a name-coded row as though it were ISO-keyed. */
  hasIsoCode: boolean;
};

let cachedByNameKey: Map<string, CountryFeatureRef> | null = null;

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Decoded once per process on first use — the same lazy-cache shape
 * us-counties.ts uses, for the same reason. */
function countriesByNameKey(): Map<string, CountryFeatureRef> {
  if (cachedByNameKey) return cachedByNameKey;
  const map = new Map<string, CountryFeatureRef>();
  for (const f of feature(worldTopology, worldTopology.objects.countries).features) {
    const name = f.properties.name;
    const hasIsoCode = f.id != null;
    map.set(nameKey(name), { code: hasIsoCode ? String(f.id) : name, name, hasIsoCode });
  }
  cachedByNameKey = map;
  return map;
}

/** Every country world-atlas draws, by display name — for a picker. */
export function listCountryFeatures(): CountryFeatureRef[] {
  return [...countriesByNameKey().values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves a country name to the code `unlogged_travel` stores, or null
 * if world-atlas draws no country by that name.
 *
 * Runs the name through `normalizeCountryName` first, so the aliases the
 * catalog already needs ("USA", "UK", "Czech Republic") work here too
 * without a second table. Returns null rather than guessing at a near
 * match — a wrong country is worse than a reported gap, the same call
 * `resolveCountyByName` makes next door.
 */
export function resolveCountryCode(name: string): CountryFeatureRef | null {
  return countriesByNameKey().get(nameKey(normalizeCountryName(name.trim()))) ?? null;
}
