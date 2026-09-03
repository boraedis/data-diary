"use client";

import { useMemo } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopologyRaw from "world-atlas/countries-110m.json";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo } from "@/components/charts/interactive/interactive-geo";
import { normalizeCountryName } from "@/lib/geo/country-names";
import type { CountryVisitEntry } from "@/lib/charts";

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

/** Choropleth of days logged per country — #24's first real InteractiveGeo
 * consumer. `data` is the server-fetched day count per (already
 * catalog-named) country; joined against world-atlas's own GeoJSON
 * feature names via normalizeCountryName (src/lib/geo/country-names.ts),
 * since this app's place catalog is free-text, not a controlled ISO
 * list. */
export function WorldVisitsChart({ data }: { data: CountryVisitEntry[] }) {
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

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
      {({ width, height }) => (
        <InteractiveGeo<CountryProperties>
          features={features}
          width={width}
          height={height}
          getValue={(f) => daysByCountry.get(f.properties.name) ?? null}
          getLabel={(f) => f.properties.name}
          valueLabel="days"
          ariaLabel="World map of days logged per country. Scroll or pinch to zoom, drag to pan. Hover a country to see how many days you've logged there."
        />
      )}
    </ResponsiveChart>
  );
}
