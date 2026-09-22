import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopoRaw from "world-atlas/countries-50m.json";
import { normalizeCountryName } from "./country-names";

/**
 * Name -> code resolution for countries (#363), the world half of the
 * unlogged-travel seed and the lookup the manage surface's country picker
 * (#367) resolves against.
 *
 * **What a country's code is here.** world-atlas carries the ISO 3166-1
 * *numeric* code as each feature's `id`, as a string — `"840"` for the
 * USA, `"124"` for Canada.
 *
 * **Which file, and why not the smaller one.** `countries-50m.json` (241
 * features), not the `countries-110m.json` (177) this and the world map
 * shipped with until #383. Natural Earth's 1:110m scale drops countries
 * below a size threshold, and the whole microstate tier goes with it:
 * Vatican City, San Marino, Monaco, Liechtenstein, Andorra, Malta and
 * Singapore were all unrepresentable — not merely undrawn, but impossible
 * to store an unlogged-travel entry against, since this list is what the
 * picker resolves against. That cost ~191KB gzipped over 110m, which
 * reverses #24's original size call deliberately: unlike the 842KB county
 * layer #107 defers behind a click, this file is needed by every visitor
 * to /charts/world on first paint, so there is no click to defer it to.
 *
 * **The five without an id.** `N. Cyprus`, `Somaliland`, `Kosovo`,
 * `Indian Ocean Ter.` and `Siachen Glacier` have no `id` at all —
 * territories with no ISO numeric code to carry. A strict ISO key would
 * make them unrepresentable, which for Kosovo in particular is a real gap
 * rather than a theoretical one. So the code falls back to the feature's
 * own name — which is not an invention here but exactly the key
 * `InteractiveGeo` already uses internally (`String(f.id ?? getLabel(f))`),
 * so the join stays one rule rather than two that can drift apart.
 * Verified none of those five names collides with a real ISO code.
 *
 * **One ISO code is not unique.** Natural Earth gives Ashmore and Cartier
 * Islands, an Australian external territory, the sovereign's code `036`,
 * so two features share it (the only such pair at this resolution —
 * checked). On the map that is harmless and arguably right: both polygons
 * are Australia and both should take Australia's colour. It matters for
 * display, where two rows carrying the same code would be a picker you
 * can't choose sensibly between — see `listPickableCountries`.
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
let cachedPickable: CountryFeatureRef[] | null = null;

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Number of coordinate positions in a geometry — a size proxy, used only
 * to pick which of two features sharing an ISO code is the country
 * proper. The features carry nothing but a `name`, so there is no
 * sovereign/dependency flag to key off; area is the next most honest
 * signal, and the gap it has to resolve is not subtle (Australia's
 * mainland against a pair of uninhabited islets). */
function positionCount(coordinates: unknown): number {
  if (!Array.isArray(coordinates)) return 0;
  if (typeof coordinates[0] === "number") return 1;
  return coordinates.reduce<number>((sum, part) => sum + positionCount(part), 0);
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

/**
 * Every feature world-atlas draws, by display name.
 *
 * Every one, including both halves of a shared ISO code — this is the
 * name-addressed view, so a day count recorded against "Ashmore and
 * Cartier Is." still finds its way to `036`. For anything that presents a
 * list to a person, use `listPickableCountries` instead.
 */
export function listCountryFeatures(): CountryFeatureRef[] {
  return [...countriesByNameKey().values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One entry per code — what a picker should offer, and what a stored code
 * should be labelled with.
 *
 * Deduped because a code is the identity `unlogged_travel` stores, so two
 * rows sharing one are not two choices: picking either writes the same
 * value, and whichever is listed second would silently win any
 * code-keyed label lookup built from this. Where a code is shared, the
 * larger geometry wins, which is the country rather than its dependency.
 */
export function listPickableCountries(): CountryFeatureRef[] {
  if (cachedPickable) return cachedPickable;
  const bestByCode = new Map<string, { ref: CountryFeatureRef; size: number }>();
  for (const f of feature(worldTopology, worldTopology.objects.countries).features) {
    const hasIsoCode = f.id != null;
    const code = hasIsoCode ? String(f.id) : f.properties.name;
    const size = positionCount((f.geometry as { coordinates?: unknown })?.coordinates);
    const current = bestByCode.get(code);
    if (!current || size > current.size) {
      bestByCode.set(code, { ref: { code, name: f.properties.name, hasIsoCode }, size });
    }
  }
  cachedPickable = [...bestByCode.values()]
    .map((entry) => entry.ref)
    .sort((a, b) => a.name.localeCompare(b.name));
  return cachedPickable;
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
