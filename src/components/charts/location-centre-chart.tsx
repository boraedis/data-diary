"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
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
  windowDetail,
  windowMix,
  type CentreArea,
  type CentrePeriod,
  type LocationCentreData,
  type AreaShare,
  type TrailPoint,
  type WindowDetail,
} from "@/lib/location-centre";
import { daysBetween } from "@/lib/date";
import type { LngLat } from "@/lib/viz/geo-centre";
import { CATEGORICAL_SLOT_COUNT, categoricalColor, sequentialScale } from "@/lib/viz/color";
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
/** The bi-monthly points: a dot small enough to read as texture along the
 * line rather than a second set of year dots, with a hover target a good
 * deal bigger than it (owner feedback: invisible points were too hard to
 * find, and a dot this size is too small to hit on its own). */
const POINT_RADIUS = 2;
const POINT_HIT_RADIUS = 7;

/** Areas named under a tooltip's mix bar. The bar itself shows every
 * area; the names stop at three so the tooltip stays compact. */
const MIX_NAMED = 3;
const MIX_BAR_WIDTH = 176;

/** The detail panel's lists stop here, with a "+N more" line after. */
const DETAIL_AREAS = 12;
const DETAIL_COUNTRIES = 6;
const DETAIL_FIRST_VISITS = 8;
/** A clicked dot is drawn at this radius until the panel closes. */
const SELECTED_RADIUS = 6;
const BRIDGE_COLOR = "var(--muted-foreground)";

const formatDays = (v: number) => formatThousandsNumber(Math.round(v));

export function LocationCentreChart({ data }: { data: LocationCentreData }) {
  const [view, setView] = useState<string>(ALL);
  const [windowDays, setWindowDays] = useState<WindowDays>("365");
  // The trail point whose detail panel is open, by marker id. Deliberately
  // not reset when the pickers change: an id that no longer exists simply
  // resolves to no panel below, and one that still does (the same point
  // under a different window) keeps its panel, now describing the new
  // window.
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const { markers, valueById, secondaryById, mixById, dateById } = useMemo(() => {
    const dateById = new Map<string, string>();
    const valueById = new Map<string, number>();
    const secondaryById = new Map<string, GeoSecondaryRow>();
    const mixById = new Map<string, AreaShare[]>();

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
    /** Tooltip content for a point on the trail: the days behind it, and
     * how they split between areas (drawn by MixDetail). The title is the
     * point's own month, not a merged label like "2016–2018": the figures
     * are this one window's. */
    const describe = (id: string, p: TrailPoint) => {
      valueById.set(id, p.days);
      dateById.set(id, p.date);
      mixById.set(id, windowMix(index, p.date, Number(windowDays)));
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
        radius: id === selectedId ? SELECTED_RADIUS : ANCHOR_RADIUS,
        annotation: group.label,
      };
    });

    // Every two months between the year dots, a small unlabelled point
    // with its own tooltip (owner's ask), so the detail's there along the
    // whole line without a label every inch. All-years view only — within
    // one year every month already has its own labelled dot.
    const pointMarkers: GeoMarker[] = [];
    if (view === ALL) {
      const anchorDates = new Set(anchors.map((a) => a.date));
      let lastBucket = "";
      for (const p of runs.flat()) {
        const bucket = `${p.date.slice(0, 4)}:${Math.floor((Number(p.date.slice(5, 7)) - 1) / 2)}`;
        if (bucket === lastBucket) continue;
        lastBucket = bucket;
        if (anchorDates.has(p.date)) continue;
        const id = `point:${p.date}`;
        pointMarkers.push({
          id,
          position: p.position,
          label: describe(id, p),
          color: colorOf(p.date),
          opacity: id === selectedId ? 1 : 0.9,
          radius: id === selectedId ? SELECTED_RADIUS : POINT_RADIUS,
          hitRadius: POINT_HIT_RADIUS,
        });
      }
    }

    // Bi-monthly points before the year dots, so a year dot wins where
    // their hover targets overlap.
    return {
      markers: [...baseMarkers, ...pointMarkers, ...anchorMarkers],
      valueById,
      secondaryById,
      mixById,
      dateById,
    };
    // selectedId rebuilds the map on a click, to enlarge the clicked dot.
    // A click, unlike a hover, is rare enough for that to cost nothing.
  }, [current, runs, view, colorOf, index, windowDays, selectedId]);

  // Only trail points open a panel; an area circle's click does nothing.
  const onMarkerClick = useCallback(
    (m: GeoMarker) => {
      const id = String(m.id);
      if (dateById.has(id)) setSelectedId((prev) => (prev === id ? null : id));
    },
    [dateById],
  );
  const selectedDate = selectedId ? dateById.get(selectedId) : undefined;
  const detail = useMemo(
    () => (selectedDate ? windowDetail(index, data.areas, selectedDate, Number(windowDays)) : null),
    [selectedDate, index, data, windowDays],
  );
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  // Stable accessors — both are useD3 dependencies inside InteractiveGeo.
  const getMarkerValue = useCallback((m: GeoMarker) => valueById.get(String(m.id)) ?? null, [valueById]);
  const getMarkerSecondary = useCallback((m: GeoMarker) => secondaryById.get(String(m.id)) ?? null, [secondaryById]);

  // Each area's colour in a mix bar is its all-time rank's fixed slot, so
  // an area is the same colour in every tooltip; beyond the fifth, areas
  // share the muted overflow colour (categoricalColor's own rule).
  const areaColor = useMemo(() => {
    const rank = new Map(data.all.bases.map((b, i) => [b.key, i]));
    return (area: number) =>
      categoricalColor(Math.min(rank.get(data.areas[area].key) ?? CATEGORICAL_SLOT_COUNT, CATEGORICAL_SLOT_COUNT));
  }, [data]);
  const getMarkerDetail = useCallback(
    (m: GeoMarker) => {
      const mix = mixById.get(String(m.id));
      return mix && mix.length > 0 ? <MixDetail mix={mix} areas={data.areas} colorOf={areaColor} /> : null;
    },
    [mixById, data, areaColor],
  );

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
            <div className="relative" style={{ width, height }}>
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
                getMarkerDetail={getMarkerDetail}
                onMarkerClick={onMarkerClick}
                ariaLabel={`World map. A line traces the centre of mass of where I spent my days${view === ALL ? "" : ` in ${view}`}, averaged over a ${WINDOW_OPTIONS.find((o) => o.id === windowDays)!.label} window and coloured from earliest to latest, with a labelled dot where each ${view === ALL ? "year" : "month"} begins. Shaded circles are the places I spent time, sized by their share of days. Scroll or pinch to zoom, drag to pan. Hover a dot or circle for details; click a dot for a full breakdown.`}
              />
              {detail && selectedDate ? (
                <DetailPanel
                  detail={detail}
                  title={formatDate(selectedDate, "monthYear")}
                  windowLabel={WINDOW_OPTIONS.find((o) => o.id === windowDays)!.label}
                  areas={data.areas}
                  colorOf={areaColor}
                  onClose={() => setSelectedId(null)}
                  maxHeight={height - 16}
                />
              ) : null}
            </div>
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}

/**
 * How a trail point's window splits between areas, in a tooltip's worth
 * of space (owner feedback: the top area alone said too little, a row
 * per area would be too tall). One thin 100% bar carries the whole mix —
 * every area, however small — and one wrapping line names the largest
 * few with their shares.
 */
function MixDetail({
  mix,
  areas,
  colorOf,
}: {
  mix: AreaShare[];
  areas: CentreArea[];
  colorOf: (area: number) => string;
}) {
  const named = mix.slice(0, MIX_NAMED);
  const rest = mix.slice(MIX_NAMED).reduce((sum, m) => sum + m.share, 0);
  return (
    <div className="flex flex-col gap-1" style={{ width: MIX_BAR_WIDTH }}>
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full" aria-hidden>
        {mix.map((m) => (
          <span key={m.area} style={{ width: `${m.share * 100}%`, background: colorOf(m.area) }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-tight">
        {named.map((m) => (
          <span key={m.area} className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: colorOf(m.area) }} />
            <span className="text-popover-foreground">{areas[m.area].label}</span>
            <span className="text-muted-foreground tabular-nums">{formatPercent(m.share)}</span>
          </span>
        ))}
        {rest > 0 ? <span className="text-muted-foreground tabular-nums">+{formatPercent(rest)} elsewhere</span> : null}
      </div>
    </div>
  );
}

/**
 * The click-to-open breakdown for one trail point (owner's ask: the hover
 * tooltip is deliberately small, so the full picture lives one click
 * away). Pinned over the map's top-right corner, full-width on a phone,
 * scrolling within the map's height. Stays open while the reader pans
 * and zooms; closes from its button, Escape, or clicking the same dot.
 */
function DetailPanel({
  detail,
  title,
  windowLabel,
  areas,
  colorOf,
  onClose,
  maxHeight,
}: {
  detail: WindowDetail;
  title: string;
  windowLabel: string;
  areas: CentreArea[];
  colorOf: (area: number) => string;
  onClose: () => void;
  maxHeight: number;
}) {
  const shownAreas = detail.areas.slice(0, DETAIL_AREAS);
  const hiddenAreas = detail.areas.slice(DETAIL_AREAS);
  const hiddenShare = hiddenAreas.reduce((sum, a) => sum + a.share, 0);
  const topShare = detail.areas[0]?.share ?? 1;
  const shownVisits = detail.firstVisits.slice(0, DETAIL_FIRST_VISITS);
  const extraVisits = detail.firstVisits.length - shownVisits.length;
  const extraCountries = detail.countries.length - DETAIL_COUNTRIES;

  return (
    <section
      aria-label={`${title} breakdown`}
      className="absolute top-2 right-2 left-2 z-20 flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-popover p-3 text-xs shadow-lg sm:left-auto sm:w-80"
      style={{ maxHeight }}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-popover-foreground">{title}</h2>
          <p className="text-muted-foreground">
            {windowLabel} window, {formatDate(detail.from, "dayYear")} – {formatDate(detail.to, "dayYear")}
          </p>
          <p className="text-muted-foreground">
            {formatThousandsNumber(detail.locatedDays)} of {formatThousandsNumber(detail.spanDays)} days located
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close breakdown"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Areas</h3>
        <ol className="flex flex-col gap-1">
          {shownAreas.map((a) => (
            <li key={a.area} className="grid grid-cols-[minmax(0,1fr)_4rem_2.5rem] items-center gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: colorOf(a.area) }} />
                <span className="truncate text-popover-foreground">{areas[a.area].label}</span>
                {areas[a.area].context ? (
                  <span className="shrink-0 truncate text-muted-foreground">{areas[a.area].context}</span>
                ) : null}
              </span>
              {/* Bars scale to the largest area, not to 100%, so a window
                  with no majority still shows the difference between its
                  top few. */}
              <span aria-hidden className="h-1.5 rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(a.share / topShare) * 100}%`, background: colorOf(a.area) }}
                />
              </span>
              <span className="text-right tabular-nums text-popover-foreground" title={`${formatDays(a.days)} days`}>
                {formatPercent(a.share)}
              </span>
            </li>
          ))}
        </ol>
        {hiddenAreas.length > 0 ? (
          <p className="text-muted-foreground">
            +{hiddenAreas.length} more area{hiddenAreas.length === 1 ? "" : "s"}, {formatPercent(hiddenShare)} of days
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Countries</h3>
        <p className="leading-relaxed text-popover-foreground">
          {detail.countries.slice(0, DETAIL_COUNTRIES).map((c, i) => (
            <span key={c.name}>
              {i > 0 ? <span className="text-muted-foreground"> · </span> : null}
              {c.name} <span className="tabular-nums text-muted-foreground">{formatPercent(c.share)}</span>
            </span>
          ))}
          {extraCountries > 0 ? <span className="text-muted-foreground"> · +{extraCountries} more</span> : null}
        </p>
      </div>

      {shownVisits.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            First visited in this window
          </h3>
          <ul className="flex flex-col gap-0.5">
            {shownVisits.map((v) => (
              <li key={v.area} className="flex justify-between gap-2">
                <span className="truncate text-popover-foreground">{areas[v.area].label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatDate(v.date, "dayYear")}</span>
              </li>
            ))}
          </ul>
          {extraVisits > 0 ? <p className="text-muted-foreground">+{extraVisits} more</p> : null}
        </div>
      ) : null}
    </section>
  );
}
