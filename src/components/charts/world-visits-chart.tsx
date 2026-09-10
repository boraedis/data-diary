"use client";

import { useCallback, useMemo } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopologyRaw from "world-atlas/countries-110m.json";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoExpansion, type GeoFeature } from "@/components/charts/interactive/interactive-geo";
import { loadUsStateFeatures, usStatesExpansion } from "@/components/charts/us-geo-levels";
import { normalizeCountryName } from "@/lib/geo/country-names";
import type { Feature, Polygon } from "geojson";
import type { CountryVisitEntry, UsStateVisitEntry } from "@/lib/charts";

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
  /** Defaults to the app-standard full-viewport `CHART_HEIGHT_CLASS`
   * (#315) — right for this chart's own dedicated `/charts/world` page,
   * wrong for the recap report, which embeds this same component as one
   * section among several rather than the page's only content. The recap
   * passes its own bounded height explicitly rather than inheriting
   * whatever this component's default happens to be. */
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

  const daysByState = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of usStates ?? []) map.set(entry.state, (map.get(entry.state) ?? 0) + entry.days);
    return map;
  }, [usStates]);

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
      return loadUsStateFeatures().then((stateFeatures) => usStatesExpansion(stateFeatures, daysByState));
    },
    [daysByState],
  );

  return (
    <ResponsiveChart className={heightClassName} minWidth={360}>
      {({ width, height }) => (
        <InteractiveGeo<CountryProperties>
          features={features}
          fitTo={FIT_BOUNDS}
          width={width}
          height={height}
          getValue={(f) => daysByCountry.get(f.properties.name) ?? null}
          getLabel={(f) => f.properties.name}
          valueLabel="days"
          resolveExpansion={usStates ? resolveExpansion : undefined}
          ariaLabel={
            usStates
              ? "World map of days logged per country. Scroll or pinch to zoom, drag to pan. Click the United States to break it into its states in place; clicking any other country zooms to it. Hover a country or state to see how many days you've logged there."
              : "World map of days logged per country. Scroll or pinch to zoom, drag to pan. Hover a country to see how many days you've logged there."
          }
        />
      )}
    </ResponsiveChart>
  );
}
