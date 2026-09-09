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
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoMarker } from "@/components/charts/interactive/interactive-geo";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { CITIES, type CityKey } from "@/lib/geo/city-config";
import type { CityHeatmapData } from "@/lib/charts";

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

// Composite (root, name) key — matches CityHeatmapNeighborhood's own
// comment in src/lib/charts.ts on why two different roots (e.g.
// Washington and Arlington) can't be keyed by name alone.
function neighborhoodKey(root: string, name: string): string {
  return `${root}\0${name}`;
}

export function CityHeatmapExplorer({ data }: { data: Record<CityKey, CityHeatmapData> }) {
  const [city, setCity] = useState<CityKey>("atlanta");
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

  const { markers, daysByMarkerId } = useMemo(() => {
    const markers: GeoMarker[] = cityData.destinations.map((d) => ({
      id: d.id,
      position: [d.lng, d.lat],
      label: d.name,
    }));
    const daysByMarkerId = new Map<string | number, number>(cityData.destinations.map((d) => [d.id, d.days]));
    return { markers, daysByMarkerId };
  }, [cityData]);

  return (
    <ChartPage
      title="City heatmap"
      filters={
        <GroupByPicker value={city} onChange={setCity} options={CITY_OPTIONS} label="City" />
      }
    >
      <ChartCard
        title={CITIES[city].label}
        description="Neighborhoods colored by days logged there; dots mark your most-visited specific places. Scroll to zoom, drag to pan, hover for detail."
        empty={cityData.neighborhoods.length === 0 && cityData.destinations.length === 0}
      >
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
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
              markers={markers}
              getMarkerValue={(m) => daysByMarkerId.get(m.id) ?? null}
              markerValueLabel="days"
              ariaLabel={`${CITIES[city].label} map. Neighborhoods colored by days logged there; dots mark your most-visited specific places. Scroll or pinch to zoom, drag to pan. Click a neighborhood to zoom into it, click the background to reset. Hover a neighborhood or dot to see its value.`}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
