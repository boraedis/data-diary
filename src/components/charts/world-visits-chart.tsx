"use client";

import { useCallback, useMemo } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopologyRaw from "world-atlas/countries-110m.json";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoExpansion, type GeoFeature } from "@/components/charts/interactive/interactive-geo";
import { loadUsStateFeatures, travelledStateFips, usStatesExpansion } from "@/components/charts/us-geo-levels";
import { normalizeCountryName } from "@/lib/geo/country-names";
import { formatFirstVisited, formatTravelledFirstVisited } from "@/lib/viz/first-visited";
import type { Feature, Geometry, Polygon } from "geojson";
import type { CountryVisitEntry, UsStateVisitEntry } from "@/lib/charts";
import type { UnloggedTravelDetail } from "@/lib/unlogged-travel";

type CountryProperties = { name: string };

// world-atlas's countries-110m.json (~108KB) rather than its 10m/50m
// siblings (3.5MB/740KB) — see #24's own acceptance criteria on not
// repeating legacy's multi-MB-per-file committed topojson. Decoded to
// GeoJSON client-side via topojson-client (not on the server, then
// serialized as page props) specifically because the decoded GeoJSON is
// ~4x larger than the topojson it comes from (topojson's whole point is
// arc-sharing compression) — shipping the compact topojson over the wire
// and decoding here keeps that size win instead of throwing it away.
const worldTopology = worldTopologyRaw as unknown as Topology<{
  countries: GeometryCollection<CountryProperties>;
}>;

// world-atlas's own spelling for the US — what normalizeCountryName maps
// "USA" onto, and what this file's drill-down has to match against.
const UNITED_STATES = "United States of America";

/**
 * The latitude band the projection is *fitted* to — not a clip on what
 * gets drawn.
 *
 * Mercator (this map's projection since #107 — see interactive-geo.tsx on
 * why a map you zoom into wants a conformal one) stretches vertically
 * without limit as latitude rises. Fitting to the raw extent of
 * world-atlas therefore hands most of the frame to three places nobody
 * has logged a day in: Antarctica sprawling across the bottom, and the
 * top of Greenland and the Canadian arctic ballooning across the top.
 * Every inhabited continent gets squeezed into what's left.
 *
 * Cropping the fit to this band instead makes the map ~16% larger on a
 * typical viewport and puts the growth where the data is. Nothing is
 * removed: Greenland, Canada and Antarctica are all still drawn, hovered
 * and coloured exactly as before — their far ends simply run past the
 * edge, which the outermost <svg> clips for free. That's what every web
 * map does with the poles.
 *
 * 72°N keeps every inhabited place this catalog could plausibly reach —
 * Alaska's north slope tops out near 71°N and Iceland, the northernmost
 * root in the place catalog, sits below 67°N — while cutting the worst of
 * the polar inflation. -58°S clears Cape Horn (~56°S), the southernmost
 * land outside Antarctica.
 */
const FIT_BOUNDS: Feature<Polygon> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-180, -58],
        [180, -58],
        [180, 72],
        [-180, 72],
        [-180, -58],
      ],
    ],
  },
};

/** Appended to the map's own aria label when unlogged travel (#366) is
 * actually on it.
 *
 * Conditional rather than always present, the same call
 * us-state-visits-chart.tsx makes: describing a tint on a map that has
 * none is a claim about the data rather than a description of the map,
 * and InteractiveGeo's legend is conditional for the same reason. */
const TRAVELLED_ARIA_SUFFIX =
  " Regions with no logged days that you travelled through are tinted separately, and say so on hover.";

/** The default for both travelled props, hoisted to module scope so a
 * caller that passes neither keeps one stable array identity across
 * renders. An inline `= []` default would be a fresh array every time,
 * which would defeat the memos below and hand `resolveExpansion` a new
 * identity on every render. */
const NO_TRAVEL: string[] = [];

/** Same hoisted-empty-array reasoning as NO_TRAVEL, for the (#370)
 * per-country first_visited/note detail array. */
const NO_TRAVEL_DETAILS: [string, UnloggedTravelDetail][] = [];

/** Choropleth of days logged per country — #24's first real InteractiveGeo
 * consumer. `data` is the server-fetched day count per (already
 * catalog-named) country; joined against world-atlas's own GeoJSON
 * feature names via normalizeCountryName (src/lib/geo/country-names.ts),
 * since this app's place catalog is free-text, not a controlled ISO
 * list.
 *
 * Clicking the US breaks it into its states in place (#107), with every
 * other country still drawn around it; every other country keeps the
 * original zoom-to-bounds. That asymmetry is the honest state of the
 * world rather than an oversight — see `resolveExpansion` below. */
export function WorldVisitsChart({
  data,
  usStates,
  travelledCountries = NO_TRAVEL,
  travelledCounties = NO_TRAVEL,
  travelledCountryDetails = NO_TRAVEL_DETAILS,
  diaryStartDate = null,
  fillViewport = true,
  heightClassName = CHART_HEIGHT_CLASS,
}: {
  data: CountryVisitEntry[];
  /** Per-state day counts, enabling the US drill-down. Omit to keep this
   * map at zoom-to-bounds only — which is what the recap does
   * (recap-people-places-section.tsx): its `data` is scoped to one recap
   * period, and there's no period-scoped state breakdown to match it, so
   * expanding it would show whole-history state numbers beside
   * period-scoped countries and quietly contradict them. Better no
   * expansion than one that disagrees with the map around it. */
  usStates?: UsStateVisitEntry[];
  /**
   * Unlogged-travel country codes (#366/#323) — countries travelled to or
   * through that never made a day's top-two place slots.
   *
   * These are `unlogged_travel.code` values, which for a country means
   * world-atlas's own feature `id` (ISO 3166-1 numeric as a string), or
   * the feature's name for the three territories that carry no id — see
   * src/lib/geo/country-lookup.ts. **Not** catalog names: unlike `data`,
   * which has to go through `normalizeCountryName` because the place
   * catalog is free-text, this is a controlled list picked against the
   * atlas itself, so it joins on the code directly.
   *
   * An array rather than the `Set` the data layer returns, because this
   * crosses the server/client boundary as a prop; it's re-Set below where
   * the membership tests happen.
   *
   * **The recap embed deliberately passes nothing here** (#366's own
   * decision, not a fallthrough). Its `data` is scoped to one recap
   * period, while an unlogged-travel entry's `first_visited` is nullable
   * by design — most of this travel predates the diary. Painting those
   * countries into a period-scoped map would assert a visit inside a
   * window the data cannot support, which is the same reasoning that
   * already makes the recap pass no `usStates`. Defaulting to empty means
   * that embed renders exactly as it did before this feature existed.
   */
  travelledCountries?: string[];
  /** Unlogged-travel county FIPS, for the US expansion's state tier
   * (#366). Only has an effect alongside `usStates` — with no expansion
   * there are no states on screen to tint. Rolled up to states by
   * `travelledStateFips`, the same helper /charts/us-states' own drill
   * view uses, so both maps agree about the same state. */
  travelledCounties?: string[];
  /**
   * Per-country `first_visited`/`note` (#370), for the country tier's
   * tooltip secondary row — an array of `[code, detail]` pairs rather
   * than the `Map` the data layer returns, same Map-can't-cross-the-
   * boundary reasoning as `travelledCountries` above, and re-Map'd below
   * where it's read. Only covers countries: a rolled-up US state's
   * travelled tint can come from several counties with different dates,
   * so there's no single honest "first visited" to show for it — see
   * `us-state-visits-chart.tsx`'s own comment on the same limit at the
   * county tier, where the granularity actually matches.
   */
  travelledCountryDetails?: [string, UnloggedTravelDetail][];
  /** `profileSettings.diaryStartDate`, for choosing "first visited" vs.
   * "first logged" wording on a logged region's secondary row — see
   * `formatFirstVisited`'s own comment. Null (the default) reads as "no
   * diary start date recorded," which just means every date prints as
   * "first visited." */
  diaryStartDate?: string | null;
  /** Defaults to `true` — right for this chart's own dedicated
   * `/charts/world` page, wrong for the recap report, which embeds this
   * same component as one section among several rather than the page's
   * only content. The recap passes `false` (plus its own bounded
   * `heightClassName`) rather than inheriting whatever this component's
   * default happens to be. */
  fillViewport?: boolean;
  /** The non-fill-viewport fallback/floor className — only matters when
   * `fillViewport` is `false` (or before it's measured). */
  heightClassName?: string;
}) {
  const features = useMemo(() => feature(worldTopology, worldTopology.objects.countries), []);

  const daysByCountry = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of data) {
      // Summed, not overwritten: getCountryVisitData already merges by
      // normalized name server-side, so this never double-counts in
      // practice — but two raw catalog names normalizing to the same
      // map country (e.g. "England" and "Scotland" both -> "United
      // Kingdom") shouldn't silently lose one entry's days here either,
      // if that invariant ever changes.
      const name = normalizeCountryName(entry.country);
      map.set(name, (map.get(name) ?? 0) + entry.days);
    }
    return map;
  }, [data]);

  const firstVisitedByCountry = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of data) {
      if (!entry.firstVisited) continue;
      const name = normalizeCountryName(entry.country);
      const prev = map.get(name);
      if (!prev || entry.firstVisited < prev) map.set(name, entry.firstVisited);
    }
    return map;
  }, [data]);

  const travelledCountryDetailByCode = useMemo(() => new Map(travelledCountryDetails), [travelledCountryDetails]);

  /** The country tier's secondary tooltip row (#370) — a logged country's
   * own first-visit date if it has one, else the travelled entry's, else
   * nothing. Real logged data wins for the same reason it wins the fill
   * itself (InteractiveGeo's own value-before-travelled precedence): a
   * country can be both logged *and* have a stray travelled row, and the
   * logged date is the more specific fact. */
  const countrySecondaryValue = useCallback(
    (f: Feature<Geometry, CountryProperties>) => {
      const logged = firstVisitedByCountry.get(f.properties.name);
      if (logged) return formatFirstVisited(logged, diaryStartDate);
      const code = String(f.id ?? f.properties.name);
      const detail = travelledCountryDetailByCode.get(code);
      return detail ? formatTravelledFirstVisited(detail.firstVisited) : null;
    },
    [firstVisitedByCountry, travelledCountryDetailByCode, diaryStartDate],
  );

  const daysByState = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of usStates ?? []) map.set(entry.state, (map.get(entry.state) ?? 0) + entry.days);
    return map;
  }, [usStates]);

  const firstVisitedByState = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of usStates ?? []) {
      if (!entry.firstVisited) continue;
      const prev = map.get(entry.state);
      if (!prev || entry.firstVisited < prev) map.set(entry.state, entry.firstVisited);
    }
    return map;
  }, [usStates]);

  const stateSecondaryValue = useCallback(
    (f: Feature<Geometry, { name: string }>) => {
      const logged = firstVisitedByState.get(f.properties.name);
      return logged ? formatFirstVisited(logged, diaryStartDate) : null;
    },
    [firstVisitedByState, diaryStartDate],
  );

  const travelledCountryCodes = useMemo(() => new Set(travelledCountries), [travelledCountries]);

  /** Which states the US expansion should tint. Unlogged travel is only
   * ever stored per county, so a state is travelled when it contains one
   * — #323's containment rule, rolled up by the shared helper. */
  const travelledStates = useMemo(() => travelledStateFips(travelledCounties), [travelledCounties]);

  /**
   * Whether a *country* is travelled-through.
   *
   * Joined on the feature's own id, with a fallback to its name for the
   * three world-atlas features that have no id at all (Kosovo,
   * Somaliland, N. Cyprus). That fallback isn't invented here: it's the
   * same `String(f.id ?? getLabel(f))` rule InteractiveGeo already keys
   * features by internally and country-lookup.ts stores codes under, so
   * there's one rule rather than two that can drift.
   *
   * Answers only "is there travelled evidence" and never looks at day
   * counts — the other half of the containment rule (a country with real
   * logged days keeps its place on the ramp) is InteractiveGeo's own
   * precedence, not something this needs to pre-empt.
   */
  const isTravelled = useCallback(
    (f: Feature<Geometry, CountryProperties>) => travelledCountryCodes.has(String(f.id ?? f.properties.name)),
    [travelledCountryCodes],
  );

  /**
   * The US is the only country that expands, and that's a real limit
   * rather than a stub: subdivision geometry for everyone else means
   * Natural Earth's admin-1 layer, which has no topojson-org-quality npm
   * package and would need a one-time conversion plus per-country name
   * reconciliation against this free-text catalog — #107's own scoping
   * discussion parked that behind #163's geometry-storage decision.
   *
   * Returning null for every other country is what keeps that honest:
   * the primitive falls back to zoom-to-bounds, exactly what this map did
   * before, instead of blanking a country that has no geometry to show.
   */
  const resolveExpansion = useCallback(
    (f: GeoFeature): Promise<GeoExpansion | null> | null => {
      if (String(f.properties?.name ?? "") !== UNITED_STATES) return null;
      return loadUsStateFeatures().then((stateFeatures) =>
        usStatesExpansion(stateFeatures, daysByState, travelledStates, stateSecondaryValue),
      );
    },
    [daysByState, travelledStates, stateSecondaryValue],
  );

  const baseAriaLabel = usStates
    ? "World map of days logged per country. Scroll or pinch to zoom, drag to pan. Click the United States to break it into its states in place; clicking any other country zooms to it. Hover a country or state to see how many days you've logged there."
    : "World map of days logged per country. Scroll or pinch to zoom, drag to pan. Hover a country to see how many days you've logged there.";

  // The state half only counts when there's an expansion to reveal it in:
  // travelled counties with no `usStates` put nothing on screen.
  const hasTravelled = travelledCountryCodes.size > 0 || (Boolean(usStates) && travelledStates.size > 0);

  return (
    <ResponsiveChart className={heightClassName} fillViewport={fillViewport} minWidth={360}>
      {({ width, height }) => (
        <InteractiveGeo<CountryProperties>
          features={features}
          fitTo={FIT_BOUNDS}
          width={width}
          height={height}
          getValue={(f) => daysByCountry.get(f.properties.name) ?? null}
          isTravelled={isTravelled}
          getLabel={(f) => f.properties.name}
          valueLabel="days"
          getSecondaryValue={countrySecondaryValue}
          secondaryLabel=""
          resolveExpansion={usStates ? resolveExpansion : undefined}
          ariaLabel={baseAriaLabel + (hasTravelled ? TRAVELLED_ARIA_SUFFIX : "")}
        />
      )}
    </ResponsiveChart>
  );
}
