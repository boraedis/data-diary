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
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import {
  indexDaily,
  mergeNearbyLabels,
  rollingTrail,
  windowMix,
  type CentrePeriod,
  type LocationCentreData,
  type TrailPoint,
} from "@/lib/location-centre";
import { daysBetween } from "@/lib/date";
import type { LngLat } from "@/lib/viz/geo-centre";
import { sequentialScale } from "@/lib/viz/color";
import { formatDate, formatPercent, formatThousandsNumber } from "@/lib/viz/format";
import { LOCATION_CENTRE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { LOCATION_CENTRE_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// The page body is one client component, the same as
// city-heatmap-explorer.tsx: the pickers in ChartPage's filters row and
// the map share state. The trail itself is computed here, from the
// per-day vectors the server sends, so changing the window is instant.

type CountryProperties = { name: string };

// countries-110m, not the 50m file the World Heatmap needs. There, a
// country missing from 110m (Singapore, Malta) couldn't be coloured or
// recorded — see world-visits-chart.tsx. Here the countries are only a
// base map under the trail, and the trail is positioned from its own
// coordinates whether or not the country beneath it is drawn, so the
// ~190KB saving costs nothing.
const worldTopology = worldTopologyRaw as unknown as Topology<{ countries: GeometryCollection<CountryProperties> }>;
const WORLD = feature(worldTopology, worldTopology.objects.countries);

const ALL = "all";

// Years, not days. Windows of a week to a quarter shipped first and read
// as noise (owner, 2026-09-30): at that scale every holiday throws the
// line across an ocean and back, and a decade of them buries the moves.
// A year or more averages trips into a nudge, which is the story here.
type WindowDays = "365" | "730" | "1095" | "1826";
const WINDOW_OPTIONS: GroupByOption<WindowDays>[] = [
  { id: "365", label: "1 year" },
  { id: "730", label: "2 years" },
  { id: "1095", label: "3 years" },
  { id: "1826", label: "5 years" },
];
/** Days between samples, per window: a couple of weeks is already far
 * finer than a year-long average can move, and a longer window moves
 * slower still. */
const STEP: Record<WindowDays, number> = { "365": 14, "730": 21, "1095": 28, "1826": 42 };

/** Aim for about this many coloured pieces per trail. Each piece is one
 * SVG path in one colour, so this is the ramp's resolution along the
 * line; more buys nothing visible and costs DOM. */
const TARGET_PIECES = 300;

/** Anchor dots closer than this share one dot and one label — years at
 * home otherwise stack their labels on one spot. */
const LABEL_MERGE_KM = 25;

/** Places this small are left out of the map's framing, so one long-haul
 * trip doesn't zoom the whole map out to fit it. They're still drawn. */
const FRAME_MIN_SHARE = 0.01;
const FRAME_PAD = 4;

/** Largest place circle, px. Area ∝ share of the period's days. */
const BASE_MAX_RADIUS = 22;
const BASE_MIN_RADIUS = 3;
const BASE_COLOR = "var(--muted-foreground)";
const ANCHOR_RADIUS = 4;
/** Hit radius of the hidden bi-monthly points. A little bigger than a
 * visible dot, since there's nothing on screen to aim at. */
const HIDDEN_POINT_RADIUS = 5;
const BRIDGE_COLOR = "var(--muted-foreground)";

const formatDays = (v: number) => formatThousandsNumber(Math.round(v));

export function LocationCentreChart({ data }: { data: LocationCentreData }) {
  const [view, setView] = useState<string>(ALL);
  const [windowDays, setWindowDays] = useState<WindowDays>("365");

  const current: CentrePeriod = useMemo(
    () => (view === ALL ? data.all : (data.years.find((y) => y.period === view) ?? data.all)),
    [data, view],
  );

  const index = useMemo(() => indexDaily(data.daily), [data]);

  const runs = useMemo(() => {
    const all = rollingTrail(index, Number(windowDays), STEP[windowDays]);
    if (view === ALL) return all;
    return all.map((run) => run.filter((p) => p.date.startsWith(`${view}-`))).filter((run) => run.length > 0);
  }, [index, windowDays, view]);

  // Colour encodes time along the trail. The domain is whatever's on
  // screen, so a single year still spans the full ramp month by month.
  const { colorOf, firstDate, lastDate } = useMemo(() => {
    const firstDate = runs[0]?.[0]?.date ?? null;
    const lastRun = runs[runs.length - 1];
    const lastDate = lastRun?.[lastRun.length - 1]?.date ?? null;
    const span = firstDate && lastDate ? Math.max(1, daysBetween(firstDate, lastDate)) : 1;
    const scale = sequentialScale([0, span]);
    return { colorOf: (date: string) => (firstDate ? scale(daysBetween(firstDate, date)) : scale(0)), firstDate, lastDate };
  }, [runs]);

  const routes = useMemo<GeoRoute[]>(() => {
    const total = runs.reduce((n, r) => n + r.length, 0);
    const pieceSize = Math.max(2, Math.ceil(total / TARGET_PIECES));
    const out: GeoRoute[] = [];
    runs.forEach((run, r) => {
      // Consecutive pieces share their boundary point, so the line has no
      // seams where the colour steps.
      for (let i = 0; i < run.length - 1; i += pieceSize - 1) {
        const piece = run.slice(i, i + pieceSize);
        out.push({
          id: `${r}:${i}`,
          coordinates: piece.map((p) => p.position),
          color: colorOf(piece[Math.floor(piece.length / 2)].date),
        });
      }
      // A dashed bridge over a stretch with too little logged to place.
      const next = runs[r + 1];
      if (next) {
        out.push({
          id: `gap:${r}`,
          coordinates: [run[run.length - 1].position, next[0].position],
          dashed: true,
          color: BRIDGE_COLOR,
        });
      }
    });
    return out;
  }, [runs, colorOf]);

  const { markers, valueById, secondaryById } = useMemo(() => {
    const valueById = new Map<string, number>();
    const secondaryById = new Map<string, GeoSecondaryRow>();

    // Places first, so the trail's dots draw on top of them.
    const baseMarkers: GeoMarker[] = current.bases.map((b) => {
      const id = `base:${b.key}`;
      valueById.set(id, b.days);
      secondaryById.set(id, { label: "share", value: `${formatPercent(b.share)} of located days` });
      return {
        id,
        position: b.position,
        label: b.context ? `${b.label}, ${b.context}` : b.label,
        color: BASE_COLOR,
        opacity: 0.3,
        radius: Math.max(BASE_MIN_RADIUS, Math.sqrt(b.share) * BASE_MAX_RADIUS),
      };
    });

    // Labelled dots where each year begins (or each month, within a year),
    // like the inspiration chart's "1900", "1950" — they're what makes the
    // trail readable as a timeline rather than a scribble.
    const anchors: (TrailPoint & { label: string })[] = [];
    let lastKey = "";
    for (const p of runs.flat()) {
      const key = view === ALL ? p.date.slice(0, 4) : p.date.slice(0, 7);
      if (key === lastKey) continue;
      lastKey = key;
      anchors.push({ ...p, label: view === ALL ? key : formatDate(`${key}-01`, "monthShort") });
    }
    /** Tooltip rows for a point on the trail: the days behind it, and the
     * area that held the most of them. The title is the point's own
     * month, not a merged label like "2016–2018": the figures are this
     * one window's. */
    const describe = (id: string, p: TrailPoint) => {
      valueById.set(id, p.days);
      const mix = windowMix(index, p.date, Number(windowDays));
      if (mix) {
        const area = data.areas[mix.area];
        secondaryById.set(id, { label: "most visited", value: `${area.label}, ${formatPercent(mix.share)}` });
      }
      return formatDate(p.date, "monthYear");
    };

    const anchorMarkers: GeoMarker[] = mergeNearbyLabels(anchors, LABEL_MERGE_KM).map((group) => {
      const first = group.members[0];
      const id = `anchor:${first.date}`;
      return {
        id,
        position: group.position,
        label: describe(id, first),
        color: colorOf(first.date),
        opacity: 1,
        radius: ANCHOR_RADIUS,
        annotation: group.label,
      };
    });

    // Every two months between the year dots, a point you can hover but
    // can't see (owner's ask): the detail's there when you look for it,
    // and the line stays a line. All-years view only — within one year
    // every month already has its own labelled dot.
    const hiddenMarkers: GeoMarker[] = [];
    if (view === ALL) {
      const anchorDates = new Set(anchors.map((a) => a.date));
      let lastBucket = "";
      for (const p of runs.flat()) {
        const bucket = `${p.date.slice(0, 4)}:${Math.floor((Number(p.date.slice(5, 7)) - 1) / 2)}`;
        if (bucket === lastBucket) continue;
        lastBucket = bucket;
        if (anchorDates.has(p.date)) continue;
        const id = `point:${p.date}`;
        hiddenMarkers.push({
          id,
          position: p.position,
          label: describe(id, p),
          color: colorOf(p.date),
          radius: HIDDEN_POINT_RADIUS,
          hoverOnly: true,
        });
      }
    }

    // Hidden points before the year dots, so a year dot wins where they
    // overlap.
    return { markers: [...baseMarkers, ...hiddenMarkers, ...anchorMarkers], valueById, secondaryById };
  }, [current, runs, view, colorOf, data, index, windowDays]);

  // Stable accessors — both are useD3 dependencies inside InteractiveGeo.
  const getMarkerValue = useCallback((m: GeoMarker) => valueById.get(String(m.id)) ?? null, [valueById]);
  const getMarkerSecondary = useCallback((m: GeoMarker) => secondaryById.get(String(m.id)) ?? null, [secondaryById]);

  // Framed once, on the places that matter and the 1-year trail, so neither
  // picker ever moves the map. A MultiPoint of corners rather than a
  // bounding polygon: d3-geo treats polygons as spherical, and a box wound
  // the wrong way round means "everything *except* this box".
  const fitTo = useMemo<Feature<MultiPoint>>(() => {
    const points: LngLat[] = [
      ...data.all.bases.filter((b) => b.share >= FRAME_MIN_SHARE).map((b) => b.position),
      ...rollingTrail(index, 365, 14).flat().map((p) => p.position),
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
  }, [data, index]);

  const coverage = current.placedDays > 0 ? current.locatedDays / current.placedDays : 0;
  const yearOptions = data.years.filter((y) => y.placedDays > 0).map((y) => y.period);
  const rampFormat = (date: string) => formatDate(date, view === ALL ? "monthYear" : "short");
  const [rampLow, rampHigh] = [colorOf(firstDate ?? ""), colorOf(lastDate ?? "")];

  return (
    <ChartPage
      title="Centre of Gravity"
      description="The centre of mass of where I spent my days, tracked over time: trips pull the line out and it drifts back, moves carry it to a new city."
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
          <GroupByPicker value={windowDays} onChange={setWindowDays} options={WINDOW_OPTIONS} label="Window" />
          {current.placedDays > 0 ? (
            <p className="ml-auto text-xs text-muted-foreground">
              {formatThousandsNumber(current.locatedDays)} of {formatThousandsNumber(current.placedDays)} days with a
              place could be located ({formatPercent(coverage)})
            </p>
          ) : null}
        </>
      }
    >
      <ChartCard empty={data.daily.length === 0}>
        {firstDate && lastDate ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              {rampFormat(firstDate)}
              <span
                aria-hidden
                className="inline-block h-1.5 w-24 rounded-full"
                style={{ background: `linear-gradient(to right, ${rampLow}, ${rampHigh})` }}
              />
              {rampFormat(lastDate)}
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block size-3 rounded-full opacity-40" style={{ background: BASE_COLOR }} />
              Places, sized by share of days
            </span>
          </div>
        ) : null}
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
              ariaLabel={`World map. A line traces the centre of mass of where I spent my days${view === ALL ? "" : ` in ${view}`}, averaged over a ${WINDOW_OPTIONS.find((o) => o.id === windowDays)!.label} window and coloured from earliest to latest, with a labelled dot where each ${view === ALL ? "year" : "month"} begins. Shaded circles are the places I spent time, sized by their share of days. Scroll or pinch to zoom, drag to pan. Hover a dot or circle for details.`}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
