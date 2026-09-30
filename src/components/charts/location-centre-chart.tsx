"use client";

import { useCallback, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, MultiPoint } from "geojson";
import worldTopologyRaw from "world-atlas/countries-110m.json";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveGeo,
  type GeoMarker,
  type GeoRoute,
  type GeoSecondaryRow,
} from "@/components/charts/interactive/interactive-geo";
import { Legend } from "@/components/charts/interactive/legend";
import {
  BASE_RADIUS_KM,
  buildPath,
  formatPeriodRuns,
  MIN_LOCATED_DAYS,
  type CentreBase,
  type CentrePeriod,
  type LocationCentreData,
} from "@/lib/location-centre";
import { categoricalColor, CATEGORICAL_SLOT_COUNT } from "@/lib/viz/color";
import { formatDate, formatPercent, formatThousandsNumber } from "@/lib/viz/format";
import { LOCATION_CENTRE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { LOCATION_CENTRE_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// The page body is one client component, the same as
// city-heatmap-explorer.tsx: the period picker in ChartPage's filters row
// and the map share one piece of state.

type CountryProperties = { name: string };

// countries-110m, not the 50m file the World Heatmap needs. There, a
// country missing from 110m (Singapore, Malta) couldn't be coloured or
// recorded — see world-visits-chart.tsx. Here the countries are only a
// base map under the markers, and a marker is positioned from its own
// coordinates whether or not the country beneath it is drawn, so the
// ~190KB saving costs nothing.
const worldTopology = worldTopologyRaw as unknown as Topology<{ countries: GeometryCollection<CountryProperties> }>;
const WORLD = feature(worldTopology, worldTopology.objects.countries);

const ALL = "all";

/** Bases this small are left out of the map's framing, so one long-haul
 * trip doesn't zoom the whole map out to fit it. They're still drawn. */
const FRAME_MIN_SHARE = 0.01;
/** Degrees of padding around the framed points. */
const FRAME_PAD = 4;

/** Largest base circle, px. Area ∝ share, so a base with all of a
 * period's days is this size and one with a quarter is half as wide. */
const BASE_MAX_RADIUS = 22;
const BASE_MIN_RADIUS = 3;
const STOP_RADIUS = 4.5;

const PATH_COLOR = "var(--foreground)";

const formatDays = (v: number) => formatThousandsNumber(Math.round(v));

export function LocationCentreChart({ data }: { data: LocationCentreData }) {
  const [view, setView] = useState<string>(ALL);

  const current: CentrePeriod = useMemo(
    () => (view === ALL ? data.all : (data.years.find((y) => y.period === view) ?? data.all)),
    [data, view],
  );

  // The path under the current view: one stop per year across all time,
  // or one per month within a picked year.
  const { pathPeriods, formatPeriod } = useMemo(() => {
    if (view === ALL) return { pathPeriods: data.years, formatPeriod: (p: string) => p };
    return {
      pathPeriods: data.months.filter((m) => m.period.startsWith(`${view}-`)),
      formatPeriod: (p: string) => formatDate(`${p}-01`, "monthShort"),
    };
  }, [data, view]);

  const { markers, routes, valueById, secondaryById } = useMemo(() => {
    const { stops, segments } = buildPath(pathPeriods);
    const valueById = new Map<string, number>();
    const secondaryById = new Map<string, GeoSecondaryRow>();

    // Bases first, so the path's dots draw on top of them.
    const baseMarkers: GeoMarker[] = current.bases.map((b) => {
      const id = `base:${b.key}`;
      valueById.set(id, b.days);
      secondaryById.set(id, { label: "share", value: `${formatPercent(b.share)} of located days` });
      return {
        id,
        position: b.position,
        label: b.context ? `${b.label}, ${b.context}` : b.label,
        color: baseColor(b),
        opacity: 0.35,
        radius: Math.max(BASE_MIN_RADIUS, Math.sqrt(b.share) * BASE_MAX_RADIUS),
      };
    });

    const stopMarkers: GeoMarker[] = stops.map((s) => {
      const id = `stop:${s.id}`;
      const label = formatPeriodRuns(s.periods, pathPeriods, formatPeriod);
      valueById.set(id, s.periods.reduce((sum, p) => sum + p.locatedDays, 0));
      const near = s.periods[0].nearestBase;
      if (near) {
        secondaryById.set(
          id,
          near.km <= BASE_RADIUS_KM
            ? { label: "centred in", value: near.label }
            : { label: "between places", value: `${formatThousandsNumber(Math.round(near.km))} km from ${near.label}` },
        );
      }
      return {
        id,
        position: s.position,
        label: view === ALL ? label : `${label} ${view}`,
        color: PATH_COLOR,
        opacity: 1,
        radius: STOP_RADIUS,
        annotation: label,
      };
    });

    const routes: GeoRoute[] = segments.map((seg) => ({
      id: seg.id,
      coordinates: [seg.from, seg.to],
      dashed: seg.dashed,
    }));

    return { markers: [...baseMarkers, ...stopMarkers], routes, valueById, secondaryById };
  }, [current, pathPeriods, formatPeriod, view]);

  // Framed once, on every centre and every base that matters all-time, so
  // switching period never moves the map — comparing years relies on the
  // frame holding still. A MultiPoint of corners rather than a bounding
  // polygon: d3-geo treats polygons as spherical, and a box wound the
  // wrong way round means "everything *except* this box".
  const fitTo = useMemo<Feature<MultiPoint>>(() => {
    const points = [
      ...data.all.bases.filter((b) => b.share >= FRAME_MIN_SHARE).map((b) => b.position),
      ...[...data.years, ...data.months].flatMap((p) => (p.centre ? [p.centre] : [])),
    ];
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const [w, e] = points.length ? [Math.min(...lngs), Math.max(...lngs)] : [-180, 180];
    const [s, n] = points.length ? [Math.min(...lats), Math.max(...lats)] : [-58, 72];
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "MultiPoint",
        coordinates: [
          [Math.max(-180, w - FRAME_PAD), Math.max(-80, s - FRAME_PAD)],
          [Math.min(180, e + FRAME_PAD), Math.min(80, n + FRAME_PAD)],
        ],
      },
    };
  }, [data]);

  // Keyed on all-time rank, so the legend names the same five bases
  // whichever period is on screen — the colours never move either.
  const legendSeries = useMemo(() => {
    const top = data.all.bases
      .filter((b) => b.colorIndex < CATEGORICAL_SLOT_COUNT)
      .sort((a, b) => a.colorIndex - b.colorIndex)
      .map((b) => ({ id: b.key, label: b.label, color: baseColor(b) }));
    if (data.all.bases.length > top.length) top.push({ id: "other", label: "Elsewhere", color: categoricalColor(CATEGORICAL_SLOT_COUNT) });
    return top;
  }, [data]);

  // Stable accessors — both are useD3 dependencies inside InteractiveGeo.
  const getMarkerValue = useCallback((m: GeoMarker) => valueById.get(String(m.id)) ?? null, [valueById]);
  const getMarkerSecondary = useCallback((m: GeoMarker) => secondaryById.get(String(m.id)) ?? null, [secondaryById]);

  const sparse = pathPeriods.filter((p) => p.sparse && p.placedDays > 0);
  const minDays = view === ALL ? MIN_LOCATED_DAYS.year : MIN_LOCATED_DAYS.month;
  const coverage = current.placedDays > 0 ? current.locatedDays / current.placedDays : 0;
  const yearOptions = data.years.filter((y) => y.placedDays > 0).map((y) => y.period);

  return (
    <ChartPage
      title="Centre of Gravity"
      description="Where my days were centred each year, and how that moved. Pick a year to follow it month by month."
      info={{
        interactionGuide: LOCATION_CENTRE_INTERACTION_GUIDE,
        methodology: LOCATION_CENTRE_METHODOLOGY,
        trackingSpan: PLACES_TRACKING_SPAN,
      }}
      filters={
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Period</span>
            {/* A native select rather than GroupByPicker's button row: a
                decade of years is too many buttons for a phone's width. */}
            <select
              value={view}
              onChange={(e) => setView(e.target.value)}
              className="h-7 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value={ALL}>All years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {current.placedDays > 0 ? (
            <p className="ml-auto text-xs text-muted-foreground">
              {formatThousandsNumber(current.locatedDays)} of {formatThousandsNumber(current.placedDays)} days with a
              place could be located ({formatPercent(coverage)})
            </p>
          ) : null}
        </>
      }
    >
      <ChartCard empty={data.all.locatedDays === 0}>
        <div className="flex flex-col gap-2 pb-3">
          <Legend series={legendSeries} className="text-xs" />
          {sparse.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Too few located days to place ({`<${minDays}`}):{" "}
              {sparse.map((p) => `${formatPeriod(p.period)} (${p.locatedDays})`).join(", ")}. Dashed lines bridge them.
            </p>
          ) : null}
        </div>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={320}>
          {({ width, height }) => (
            <InteractiveGeo<CountryProperties>
              features={WORLD}
              width={width}
              height={height}
              getValue={() => null}
              getLabel={(f) => f.properties.name}
              regionsAsBasemap
              fitTo={fitTo}
              markers={markers}
              routes={routes}
              getMarkerValue={getMarkerValue}
              formatMarkerValue={formatDays}
              markerValueLabel="located days"
              getMarkerSecondaryValue={getMarkerSecondary}
              ariaLabel={
                view === ALL
                  ? "World map. A line joins where my days were centred in each year, in order, each dot labelled with its years; shaded circles behind it are the places I spent time, sized by their share of days. Scroll or pinch to zoom, drag to pan. Hover a dot or circle for details."
                  : `World map. A line joins where my days were centred in each month of ${view}, each dot labelled with its months; shaded circles behind it are the places I spent time that year, sized by their share of days. Scroll or pinch to zoom, drag to pan. Hover a dot or circle for details.`
              }
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}

/** Fixed slot by all-time rank; everything past the fifth shares the
 * muted overflow colour (categoricalColor's own rule). */
function baseColor(base: CentreBase): string {
  return categoricalColor(Math.min(base.colorIndex, CATEGORICAL_SLOT_COUNT));
}
