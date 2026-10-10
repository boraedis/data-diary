"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import { TriangleAlert } from "lucide-react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import atlantaTopoRaw from "@/data/geo/atlanta.topo.json";
import dcMetroTopoRaw from "@/data/geo/dc-metro.topo.json";
import dubaiTopoRaw from "@/data/geo/dubai.topo.json";
import nycTopoRaw from "@/data/geo/nyc.topo.json";
import istanbulTopoRaw from "@/data/geo/istanbul.topo.json";
import { Button } from "@/components/ui/button";
import { ChartPage } from "@/components/charts/chart-page";
import { CityHeatmapQaModal } from "@/components/charts/city-heatmap-qa-modal";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoMarker } from "@/components/charts/interactive/interactive-geo";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { CITIES, DEFAULT_CITY, type CityKey } from "@/lib/geo/city-config";
import { loadCityWater, type WaterProperties } from "@/lib/geo/water";
import type { CityHeatmapData } from "@/lib/charts";
import { formatFirstVisited } from "@/lib/viz/first-visited";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { CITY_HEATMAP_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

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

type CityProperties = {
  name: string;
  root: string;
  /** Istanbul's mahalles: the district they belong to. */
  district?: string;
  /** A suburban county's "Rest of <county>" backdrop — see
   * scripts/geo-fetch-suburbs.mjs. */
  remainder?: boolean;
};

// The name written on a polygon. Not `properties.name` as-is: a mahalle
// whose name repeats across Istanbul is stored "Cumhuriyet (Beşiktaş)" to
// keep it unique, which is the tooltip's job to say, not the polygon's. A
// county's "Rest of ..." backdrop gets no label at all, since it sits
// under the towns drawn on top of it and its name would be written across
// them. Module-level because InteractiveGeo takes it as a useD3 dependency.
// Water is drawn over a city's suburban regions (Census land, which runs out
// across rivers and bays) but under its own neighborhoods. Built per city in
// the explorer, since which roots are suburbs is per-city config.
function suburbRootsOf(city: CityKey): Set<string> {
  return new Set((CITIES[city].suburbs ?? []).map((s) => s.root));
}

function regionLabel(f: { properties: CityProperties }): string | null {
  const { name, district, remainder } = f.properties;
  if (remainder) return null;
  return district ? name.replace(/ \([^)]*\)$/, "") : name;
}

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

export function CityHeatmapExplorer({
  data,
  diaryStartDate = null,
  initialCity = DEFAULT_CITY,
}: {
  data: Record<CityKey, CityHeatmapData>;
  /** The city the URL named (`?city=`), already validated by the page.
   * Read once for the initial state; after that the component owns the
   * choice and writes it back to the URL itself — see `selectCity`. */
  initialCity?: CityKey;
  /** `profileSettings.diaryStartDate` — see WorldVisitsChart's own prop
   * of the same name (#370). */
  diaryStartDate?: string | null;
}) {
  const [city, setCity] = useState<CityKey>(initialCity);
  const [destinations, setDestinations] = useState<"shown" | "hidden">("shown");
  const [qaOpen, setQaOpen] = useState(false);
  const router = useRouter();
  const cityData = data[city];

  // The picked city lives in the URL so a refresh (or a shared link) lands
  // back on it. `history.replaceState` rather than `router.replace`: the
  // page is force-dynamic and already holds every city's data, so a
  // navigation would only re-run the server fetch to learn what this
  // component already knows. Next.js folds a native replaceState into its
  // own router state, so `router.refresh()` after a QA change keeps the
  // param. Replace, not push, so flipping between cities doesn't fill the
  // back button with tab changes.
  const selectCity = useCallback((next: CityKey) => {
    setCity(next);
    const url = new URL(window.location.href);
    url.searchParams.set("city", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // Open-item count per city, for the check button's warning. Fetched the
  // first time a city is shown (the check reads every geocoded place, so
  // not all five up front), then kept current by the modal itself, which
  // reports the count each time it re-runs the check after a dismissal or
  // mapping. `undefined` means "not checked yet", which shows no warning
  // rather than a false all-clear.
  const [openCounts, setOpenCounts] = useState<Partial<Record<CityKey, number>>>({});
  useEffect(() => {
    if (openCounts[city] !== undefined) return;
    let cancelled = false;
    fetch(`/api/city-heatmap-qa?city=${encodeURIComponent(city)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((report: { open?: unknown[] } | null) => {
        if (!cancelled && report && Array.isArray(report.open)) {
          const count = report.open.length;
          setOpenCounts((prev) => ({ ...prev, [city]: count }));
        }
      })
      // A failed background check just means no warning; the modal reports
      // its own error when opened.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [city, openCounts]);
  const reportOpenCount = useCallback(
    (count: number) => setOpenCounts((prev) => (prev[city] === count ? prev : { ...prev, [city]: count })),
    [city],
  );
  const openCount = openCounts[city] ?? 0;

  const features = useMemo(() => {
    const topo = CITY_TOPOLOGIES[city];
    return feature(topo, topo.objects[city]);
  }, [city]);

  // The primary city's outline (`primary` in the city config): one clean
  // boundary ring, carried in the topology as its own `outline` object —
  // see CityConfig.primary for why it isn't the neighborhoods dissolved.
  const outlines = useMemo(() => {
    const topo = CITY_TOPOLOGIES[city];
    if (!CITIES[city].primary || !topo.objects.outline) return undefined;
    return feature(topo, topo.objects.outline).features;
  }, [city]);
  const primaryName = CITIES[city].primary?.name;
  const waterOverRegion = useMemo(() => {
    const suburbs = suburbRootsOf(city);
    return suburbs.size > 0 ? (f: { properties: CityProperties }) => suburbs.has(f.properties.root) : undefined;
  }, [city]);

  // A city with `homeRoots` (DC metro, #281) opens framed on just those
  // roots: InteractiveGeo fits its projection to `fitTo` and resets to
  // that same frame on a background click, so one prop covers both. Its
  // default zoom floor is 1 (the fitted frame), which would strand the
  // rest of the map off-screen, so the floor drops to whatever fits
  // everything back in. Measured in a throwaway fitted projection's
  // pixels, not degrees, so Mercator's stretch is accounted for; the
  // 0.9 leaves a margin, and taking the tighter axis means the whole map
  // fits whatever the card's aspect ratio.
  const { fitTo, zoomExtent } = useMemo(() => {
    const homeRoots = CITIES[city].homeRoots;
    if (!homeRoots) return { fitTo: undefined, zoomExtent: undefined };
    const fitTo = { ...features, features: features.features.filter((f) => homeRoots.includes(f.properties.root)) };
    const path = d3.geoPath(d3.geoMercator().fitSize([1000, 1000], fitTo));
    const [[hx0, hy0], [hx1, hy1]] = path.bounds(fitTo);
    const [[ax0, ay0], [ax1, ay1]] = path.bounds(features);
    const floor = 0.9 * Math.min((hx1 - hx0) / (ax1 - ax0), (hy1 - hy0) / (ay1 - ay0));
    return { fitTo, zoomExtent: [Math.min(1, floor), 128] as [number, number] };
  }, [city, features]);

  // Water under the map (#286), lazy-loaded per city — see
  // src/lib/geo/water.ts for why it isn't statically imported like the
  // neighborhoods above. Stored with the city it belongs to, so for the
  // moment between switching city and the new file arriving the map shows
  // no water rather than the *previous* city's water through the new
  // city's projection. The map simply gains its water a beat after the
  // neighborhoods — no loading state, since nothing about reading the
  // chart waits on it. A failed load leaves the map water-less, which is
  // exactly how it looked before this overlay existed.
  const [loadedWater, setLoadedWater] = useState<{
    city: CityKey;
    features: FeatureCollection<Geometry, WaterProperties>;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCityWater(city)
      .then((features) => {
        if (!cancelled) setLoadedWater({ city, features });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [city]);
  const water = loadedWater?.city === city ? loadedWater.features : undefined;

  const daysByFeature = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of cityData.neighborhoods) map.set(neighborhoodKey(n.root, n.name), n.days);
    return map;
  }, [cityData]);

  const firstVisitedByFeature = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of cityData.neighborhoods) if (n.firstVisited) map.set(neighborhoodKey(n.root, n.name), n.firstVisited);
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
      title="City Heatmap"
      description="A heatmap of the neighborhoods of Atlanta, DC, Dubai, NYC, and Istanbul describing where I have visited and spent time in."
      info={{
        interactionGuide: GEO_INTERACTION_GUIDE,
        methodology: CITY_HEATMAP_METHODOLOGY,
        trackingSpan: PLACES_TRACKING_SPAN,
      }}
      filters={
        <>
          <GroupByPicker value={city} onChange={selectCity} options={CITY_OPTIONS} label="City" />
          <GroupByPicker
            value={destinations}
            onChange={setDestinations}
            options={DESTINATION_OPTIONS}
            label="Destinations"
            className="ml-auto"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setQaOpen(true)}
            aria-label={openCount > 0 ? `Check places: ${openCount} outstanding` : "Check places"}
            className={openCount > 0 ? "border-amber-500/60 text-amber-400" : undefined}
          >
            {openCount > 0 ? (
              // Blinks (a pulse a touch faster than Tailwind's default) so
              // an outstanding item is noticed without opening the modal;
              // motion-safe so a reduced-motion reader gets the same icon
              // and count, held still.
              <TriangleAlert aria-hidden className="motion-safe:animate-[pulse_1.2s_ease-in-out_infinite]" />
            ) : null}
            Check places
            {openCount > 0 ? <span className="tabular-nums">({openCount})</span> : null}
          </Button>
        </>
      }
    >
      {/* #293's coordinate check. onChanged refetches the server data,
          since adding or removing a neighborhood mapping changes which
          polygon a place colours. */}
      <CityHeatmapQaModal
        open={qaOpen}
        onClose={() => setQaOpen(false)}
        cityKey={city}
        onChanged={() => router.refresh()}
        onOpenCount={reportOpenCount}
      />
      <ChartCard empty={cityData.neighborhoods.length === 0 && cityData.destinations.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={360}>
          {({ width, height }) => (
            <InteractiveGeo<CityProperties>
              features={features}
              fitTo={fitTo}
              zoomExtent={zoomExtent}
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
              getSecondaryValue={(f) => {
                const date = firstVisitedByFeature.get(neighborhoodKey(f.properties.root, f.properties.name));
                return date ? formatFirstVisited(date, diaryStartDate) : null;
              }}
              contextFeatures={water}
              waterOverRegion={waterOverRegion}
              outlines={outlines}
              getRegionLabel={regionLabel}
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
              ariaLabel={`${CITIES[city].label} map. Neighborhoods colored by days logged there and named once they are large enough, with surrounding water shown in blue; dot size shows how often you've visited. Scroll or pinch to zoom, drag to pan. Click a neighborhood to zoom into it, click the background to reset. Hover a neighborhood or dot to see its value.`}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
      {primaryName ? (
        <p className="text-xs text-muted-foreground">
          The outline marks {primaryName}, the central city; the towns and counties around it are drawn for context.
        </p>
      ) : null}
    </ChartPage>
  );
}
