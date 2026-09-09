"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import statesTopologyRaw from "us-atlas/states-10m.json";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo } from "@/components/charts/interactive/interactive-geo";
import type { UsStateVisitEntry } from "@/lib/charts";

type StateProperties = { name: string };

// us-atlas's states-10m.json (~114KB), the standard/published-geography
// path #163 locked in — no custom TopoJSON committed for this chart, the
// same way world-visits-chart.tsx leans on world-atlas. Decoded to GeoJSON
// client-side rather than on the server for the reason that file spells
// out in full: decoded GeoJSON is several times larger than the TopoJSON
// it comes from, so shipping the compact form over the wire and decoding
// here is what keeps the size win.
//
// The 10m file, not us-atlas's *-albers-10m sibling: the albers files are
// pre-projected into screen coordinates and want d3.geoIdentity, which
// isn't a GeoProjection and so doesn't fit InteractiveGeo's `projection`
// prop without a cast. Projecting real lon/lat here costs nothing
// measurable and keeps the primitive's contract honest.
const statesTopology = statesTopologyRaw as unknown as Topology<{
  states: GeometryCollection<StateProperties>;
}>;

// us-atlas ships 56 state-level features: the 50 states, DC (FIPS 11), and
// 5 territories — American Samoa (60), Guam (66), the Northern Mariana
// Islands (69), Puerto Rico (72) and the US Virgin Islands (78). FIPS
// codes for the states and DC all fall at or below 56, and the territories
// all start at 60, so the numeric cut is exact rather than a heuristic.
//
// The cut exists because d3.geoAlbersUsa — the composite projection that
// produces the familiar lower-48 layout with Alaska and Hawaii as insets,
// and the only sane choice for a US map — has no defined position for
// anything outside the 50 states + DC: it returns null for those
// coordinates. A territory feature left in would render as a path with no
// `d`, i.e. an invisible, unhoverable nothing sitting in the legend's
// color domain. Filtered out here and reported explicitly below instead —
// see `offMapEntries`.
const MAX_ALBERS_USA_FIPS = 56;

export function UsStateVisitsChart({ data }: { data: UsStateVisitEntry[] }) {
  const features = useMemo(() => {
    const decoded = feature(statesTopology, statesTopology.objects.states);
    return {
      ...decoded,
      features: decoded.features.filter((f) => Number(f.id) <= MAX_ALBERS_USA_FIPS),
    };
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

  return (
    <>
      <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
        {({ width, height }) => (
          <InteractiveGeo<StateProperties>
            features={features}
            width={width}
            height={height}
            // geoAlbersUsa, not this primitive's geoNaturalEarth1 default
            // (built for whole-world extents) and not geoMercator (which
            // would stretch Alaska across the top and leave the lower 48
            // squeezed into a corner): the composite is the one projection
            // that renders all 50 states together at one honest, roughly
            // equal-area scale — exactly the comparison a per-state
            // choropleth is asking the reader to make.
            projection={() => d3.geoAlbersUsa()}
            getValue={(f) => daysByState.get(f.properties.name) ?? null}
            getLabel={(f) => f.properties.name}
            valueLabel="days"
            ariaLabel="Map of the United States, with each state shaded by how many days you've logged there. Scroll or pinch to zoom, drag to pan. Click a state to zoom into it, click the background to reset. Hover a state to see its exact count."
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
    </>
  );
}
