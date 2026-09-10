"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import atlantaTopoRaw from "@/data/geo/atlanta.topo.json";
import dcMetroTopoRaw from "@/data/geo/dc-metro.topo.json";
import dubaiTopoRaw from "@/data/geo/dubai.topo.json";
import nycTopoRaw from "@/data/geo/nyc.topo.json";
import istanbulTopoRaw from "@/data/geo/istanbul.topo.json";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoMarker } from "@/components/charts/interactive/interactive-geo";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { CITIES, type CityKey } from "@/lib/geo/city-config";
import type { CityHeatmapData } from "@/lib/charts";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

// The page body (title, city-picker filter row, and chart card) is one
// client component rather than split between a server page and a chart
// component — same reasoning exercise-mix-explorer.tsx's own header
// comment gives: the picked city has to be shared between the filters
// row (ChartPage's dedicated slot) and the chart itself, and both need
// to come from the same component tree to share that state.
//
// All 5 cities' data is server-fetched up front (this file's own props),
// not lazily per-pick — every city's payload is small (a few hundred KB
// of topojson at most) and this avoids a network round-trip / loading
// state on every city switch, matching how every other filtered chart in
// this app already works (client-side re-slicing of one server fetch,
// not a fetch per filter change).

type CityProperties = { name: string; root: string };

const CITY_TOPOLOGIES: Record<CityKey, Topology<{ [key: string]: GeometryCollection<CityProperties> }>> = {
  atlanta: atlantaTopoRaw as unknown as Topology<{ atlanta: GeometryCollection<CityProperties> }>,
  "dc-metro": dcMetroTopoRaw as unknown as Topology<{ "dc-metro": GeometryCollection<CityProperties> }>,
  dubai: dubaiTopoRaw as unknown as Topology<{ dubai: GeometryCollection<CityProperties> }>,
  nyc: nycTopoRaw as unknown as Topology<{ nyc: GeometryCollection<CityProperties> }>,
  istanbul: istanbulTopoRaw as unknown as Topology<{ istanbul: GeometryCollection<CityProperties> }>,
};

// Display order for the picker — CITIES is a Record, not inherently
// ordered for UI purposes even though JS happens to preserve string-key
// insertion order.
const CITY_ORDER: CityKey[] = ["atlanta", "dc-metro", "dubai", "nyc", "istanbul"];
const CITY_OPTIONS: GroupByOption<CityKey>[] = CITY_ORDER.map((id) => ({ id, label: CITIES[id].label }));

// A real two-option GroupByPicker for the destinations toggle, same as
// exercise-mix-explorer.tsx's own stacked/proportional switch — not a new
// checkbox/switch component for what's structurally the same "pick one of
// a small fixed set" control every other filter row in this app already
// uses.
const DESTINATION_OPTIONS: GroupByOption<"shown" | "hidden">[] = [
  { id: "shown", label: "Show" },
  { id: "hidden", label: "Hide" },
];

// Composite (root, name) key — matches CityHeatmapNeighborhood's own
// comment in src/lib/charts.ts on why two different roots (e.g.
// Washington and Arlington) can't be keyed by name alone.
function neighborhoodKey(root: string, name: string): string {
  return `${root}\0${name}`;
}

export function CityHeatmapExplorer({ data }: { data: Record<CityKey, CityHeatmapData> }) {
  const [city, setCity] = useState<CityKey>("atlanta");
  const [destinations, setDestinations] = useState<"shown" | "hidden">("shown");
  const cityData = data[city];

  const features = useMemo(() => {
    const topo = CITY_TOPOLOGIES[city];
    return feature(topo, topo.objects[city]);
  }, [city]);

  const daysByFeature = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of cityData.neighborhoods) map.set(neighborhoodKey(n.root, n.name), n.days);
    return map;
  }, [cityData]);

  const { destinationMarkers, daysByMarkerId, neighborhoodByMarkerId } = useMemo(() => {
    const destinationMarkers: GeoMarker[] = cityData.destinations.map((d) => ({
      id: d.id,
      position: [d.lng, d.lat],
      label: d.name,
    }));
    const daysByMarkerId = new Map<string | number, number>(cityData.destinations.map((d) => [d.id, d.days]));
    // Explicit "not mapped" string, not a missing map entry — a place
    // whose neighborhood has no matching geometry feature still gets a
    // real tooltip row saying so, which is the whole point (spotting a
    // geometry/alias-table gap from the map itself, per #177's own
    // follow-up ask), not something to silently omit.
    const neighborhoodByMarkerId = new Map<string | number, string>(
      cityData.destinations.map((d) => [d.id, d.neighborhood?.name ?? "not mapped"]),
    );
    return { destinationMarkers, daysByMarkerId, neighborhoodByMarkerId };
  }, [cityData]);
  // Not `markers={destinations === "shown" ? destinationMarkers : []}`
  // inline below — a fresh `[]` literal on every render that's toggled
  // off would sit in InteractiveGeo's own useD3 deps array and rebuild
  // the whole SVG on every unrelated re-render, the exact bug this app's
  // other primitives have their own module comments warning about (see
  // interactive-network.tsx's). Memoized here instead.
  const visibleMarkers = useMemo(
    () => (destinations === "shown" ? destinationMarkers : []),
    [destinations, destinationMarkers],
  );

  return (
    <ChartPage
      title="City heatmap"
      description={`${CITIES[city].label} — neighborhoods colored by days logged there; dot size shows how often you've visited.`}
      info={{ interactionGuide: GEO_INTERACTION_GUIDE }}
      filters={
        <>
          <GroupByPicker value={city} onChange={setCity} options={CITY_OPTIONS} label="City" />
          <GroupByPicker
            value={destinations}
            onChange={setDestinations}
            options={DESTINATION_OPTIONS}
            label="Destinations"
            className="ml-auto"
          />
        </>
      }
    >
      <ChartCard empty={cityData.neighborhoods.length === 0 && cityData.destinations.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={360}>
          {({ width, height }) => (
            <InteractiveGeo<CityProperties>
              features={features}
              width={width}
              height={height}
              // geoMercator, not geoAzimuthalEqualArea — see
              // interactive-geo.tsx's own module comment (corrected after
              // this shipped with the azimuthal version, which sheared
              // badly: it needs explicit rotation onto the data that
              // fitSize alone doesn't provide, and buys no real accuracy
              // benefit at city scale anyway).
              projection={() => d3.geoMercator()}
              getValue={(f) => daysByFeature.get(neighborhoodKey(f.properties.root, f.properties.name)) ?? null}
              getLabel={(f) => f.properties.name}
              valueLabel="days"
              markers={visibleMarkers}
              getMarkerValue={(m) => daysByMarkerId.get(m.id) ?? null}
              markerValueLabel="days"
              getMarkerSecondaryValue={(m) => neighborhoodByMarkerId.get(m.id) ?? null}
              markerSecondaryLabel="neighborhood"
              // scaleMarkersByValue stays at its default (true) — bigger
              // dots for more-visited places. An earlier version of this
              // chart turned that off on the theory that plotting every
              // place (not just a curated top-N) would make size-by-
              // frequency read as noise; reverted per feedback that the
              // size signal was worth keeping even at full density, now
              // that dots no longer balloon on zoom (below) and can be
              // hidden entirely via the toggle above when they crowd a
              // small neighborhood.
              ariaLabel={`${CITIES[city].label} map. Neighborhoods colored by days logged there; dot size shows how often you've visited. Scroll or pinch to zoom, drag to pan. Click a neighborhood to zoom into it, click the background to reset. Hover a neighborhood or dot to see its value.`}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
