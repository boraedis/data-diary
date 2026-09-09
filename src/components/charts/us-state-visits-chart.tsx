"use client";

import { useCallback, useMemo } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import statesTopologyRaw from "us-atlas/states-10m.json";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoFeature, type GeoLevel } from "@/components/charts/interactive/interactive-geo";
import {
  isAlbersUsaDrawable,
  loadUsCountyFeatures,
  usCountiesLevel,
  usProjection,
  type UsStateProperties,
} from "@/components/charts/us-geo-levels";
import type { UsCountyVisitData, UsStateVisitEntry } from "@/lib/charts";

// us-atlas's states-10m.json (~114KB), the standard/published-geography
// path #163 locked in — no custom TopoJSON committed for this chart, the
// same way world-visits-chart.tsx leans on world-atlas. Decoded to GeoJSON
// client-side rather than on the server for the reason that file spells
// out in full: decoded GeoJSON is several times larger than the TopoJSON
// it comes from, so shipping the compact form over the wire and decoding
// here is what keeps the size win.
//
// Statically imported here, unlike the county layer (loaded on demand in
// us-geo-levels.ts): states *are* this page, so there's nothing to defer.
//
// The 10m file, not us-atlas's *-albers-10m sibling: the albers files are
// pre-projected into screen coordinates and want d3.geoIdentity, which
// isn't a GeoProjection and so doesn't fit InteractiveGeo's `projection`
// prop without a cast. Projecting real lon/lat here costs nothing
// measurable and keeps the primitive's contract honest.
const statesTopology = statesTopologyRaw as unknown as Topology<{
  states: GeometryCollection<UsStateProperties>;
}>;

export function UsStateVisitsChart({ data, counties }: { data: UsStateVisitEntry[]; counties: UsCountyVisitData }) {
  const features = useMemo(() => {
    const decoded = feature(statesTopology, statesTopology.objects.states);
    // Territories dropped — see isAlbersUsaDrawable's own comment, and
    // `offMapEntries` below for where their days go instead.
    return { ...decoded, features: decoded.features.filter((f) => isAlbersUsaDrawable(f.id)) };
  }, []);

  const daysByState = useMemo(() => {
    const map = new Map<string, number>();
    // Summed rather than overwritten, same defensive reasoning
    // world-visits-chart.tsx gives: getUsStateVisitData already merges by
    // resolved feature name, so this never actually double-counts today —
    // but if two catalog spellings ever normalize onto one state, losing
    // one silently would be worse than adding them.
    for (const entry of data) map.set(entry.state, (map.get(entry.state) ?? 0) + entry.days);
    return map;
  }, [data]);

  const daysByCountyFips = useMemo(
    () => new Map(counties.counties.map((c) => [c.fips, c.days])),
    [counties],
  );

  // Days that resolved to a real us-atlas feature the map above can't
  // draw — in practice the US Virgin Islands, which this catalog has real
  // logged days in. Surfaced as a line of text under the chart rather than
  // dropped: "the projection can't place it" is a fine reason not to color
  // a polygon, and a terrible reason to make someone's logged days
  // disappear from the page entirely.
  const offMapEntries = useMemo(() => {
    const drawn = new Set(features.features.map((f) => f.properties.name));
    return data.filter((entry) => !drawn.has(entry.state));
  }, [data, features]);

  /** Clicking a state loads that state's counties (#107). Returns a
   * promise rather than a level, so the 842KB county layer is fetched on
   * this click instead of shipped with the page — see
   * loadUsCountyFeatures. Depth 1 is already counties, the bottom of this
   * chain, so it returns null there and the primitive falls back to
   * zoom-to-bounds. */
  const resolveDrilldown = useCallback(
    (f: GeoFeature, depth: number): Promise<GeoLevel | null> | null => {
      if (depth !== 0) return null;
      const stateFips = String(f.id);
      const stateName = String(f.properties?.name ?? "");
      return loadUsCountyFeatures(stateFips).then((countyFeatures) =>
        // A state whose counties somehow didn't load leaves the map where
        // it is rather than swapping in an empty drawing.
        countyFeatures.features.length === 0
          ? null
          : usCountiesLevel(stateName, stateFips, countyFeatures, daysByCountyFips),
      );
    },
    [daysByCountyFips],
  );

  return (
    <>
      <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
        {({ width, height }) => (
          <InteractiveGeo<UsStateProperties>
            features={features}
            width={width}
            height={height}
            // geoAlbersUsa, not this primitive's geoNaturalEarth1 default
            // (built for whole-world extents) and not geoMercator (which
            // would stretch Alaska across the top and leave the lower 48
            // squeezed into a corner): the composite is the one projection
            // that renders all 50 states together at one honest, roughly
            // equal-area scale — exactly the comparison a per-state
            // choropleth is asking the reader to make. Shared with the
            // county level below, which inherits it.
            projection={usProjection}
            getValue={(f) => daysByState.get(f.properties.name) ?? null}
            getLabel={(f) => f.properties.name}
            valueLabel="days"
            resolveDrilldown={resolveDrilldown}
            rootLabel="United States"
            ariaLabel="Map of the United States, with each state shaded by how many days you've logged there. Scroll or pinch to zoom, drag to pan. Click a state to drill into its counties. Hover a state to see its exact count."
          />
        )}
      </ResponsiveChart>
      {offMapEntries.length > 0 ? (
        <p className="pt-3 text-xs text-muted-foreground">
          Not drawn on this map:{" "}
          {offMapEntries.map((e) => `${e.state} (${e.days} ${e.days === 1 ? "day" : "days"})`).join(", ")} — the
          composite US projection covers the 50 states and DC only.
        </p>
      ) : null}
      {counties.unresolvedDays > 0 ? (
        <p className="pt-1 text-xs text-muted-foreground">
          {counties.unresolvedDays} {counties.unresolvedDays === 1 ? "day" : "days"} in the US couldn&apos;t be placed
          in a county — usually an address geocoded just offshore. Counted on the state map above, missing from the
          county view.
        </p>
      ) : null}
    </>
  );
}
