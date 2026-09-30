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
import { Legend } from "@/components/charts/interactive/legend";
import { YearRangePicker } from "@/components/charts/interactive/year-range-picker";
import {
  indexDaily,
  mergeNearbyLabels,
  rangeSummary,
  rollingTrail,
  windowDetail,
  windowMix,
  type CentreArea,
  type LocationCentreData,
  type AreaShare,
  type TrailPoint,
  type WindowDetail,
} from "@/lib/location-centre";
import { daysBetween } from "@/lib/date";
import type { LngLat } from "@/lib/viz/geo-centre";
import { AREA_COLORS, AREA_OVERFLOW_COLOR, areaColorForRank } from "@/lib/viz/area-colors";
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

/** Largest area circle, px. Area ∝ share of the range's days. */
const BASE_MAX_RADIUS = 22;
const BASE_MIN_RADIUS = 3;
/** Circles sit on top of the trail, so they stay translucent enough for
 * the line to show through, but opaque enough for their colour to read —
 * the ten area colours were validated as solid marks. */
const BASE_OPACITY = 0.45;
/** How many areas get their own colour and a name on the map — one per
 * AREA_COLORS entry (owner's ask: the top ten, 2026-09-30). */
const NAMED_AREAS = AREA_COLORS.length;
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
  const firstYear = data.years[0]?.year ?? 0;
  const lastYear = data.years[data.years.length - 1]?.year ?? 0;
  const yearDomain = useMemo<[number, number]>(() => [firstYear, lastYear], [firstYear, lastYear]);
  // null = every year, so the picker always opens on the whole record.
  const [pickedRange, setPickedRange] = useState<[number, number] | null>(null);
  const [fromYear, toYear] = pickedRange ?? yearDomain;
  const wholeRecord = fromYear === yearDomain[0] && toYear === yearDomain[1];
  // One year reads month by month; more than one, year by year.
  const singleYear = fromYear === toYear;
  const [windowDays, setWindowDays] = useState<WindowDays>("365");
  // The trail point whose detail panel is open, by marker id. Deliberately
  // not reset when the pickers change: an id that no longer exists simply
  // resolves to no panel below, and one that still does (the same point
  // under a different window) keeps its panel, now describing the new
  // window.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const current = useMemo(() => rangeSummary(data, fromYear, toYear), [data, fromYear, toYear]);

  const index = useMemo(() => indexDaily(data.daily), [data]);

  const { runs, endDate } = useMemo(() => {
    const all = rollingTrail(index, Number(windowDays), STEP[windowDays]);
    // The whole trail's last point, before any year filter — the only one
    // that gets the "Now" dot, so a range ending in the past never claims it.
    const endDate = all[all.length - 1]?.[all[all.length - 1].length - 1]?.date ?? null;
    if (wholeRecord) return { runs: all, endDate };
    const [from, to] = [`${fromYear}-01-01`, `${toYear}-12-31`];
    return {
      runs: all.map((run) => run.filter((p) => p.date >= from && p.date <= to)).filter((run) => run.length > 0),
      endDate,
    };
  }, [index, windowDays, wholeRecord, fromYear, toYear]);

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

    // Areas first, so the trail's dots draw on top of them. The top ten
    // by all-time days carry their own colour and their name on the map:
    // ten colours can't all be told apart by colour alone (see
    // area-colors.ts), so the names are what identify them.
    const baseMarkers: GeoMarker[] = current.bases.map((b) => {
      const id = `base:${b.key}`;
      valueById.set(id, b.days);
      secondaryById.set(id, { label: "share", value: `${formatPercent(b.share)} of located days` });
      return {
        id,
        position: b.position,
        label: b.context ? `${b.label}, ${b.context}` : b.label,
        color: areaColorForRank(b.rank),
        opacity: BASE_OPACITY,
        radius: Math.max(BASE_MIN_RADIUS, Math.sqrt(b.share) * BASE_MAX_RADIUS),
        annotation: b.rank < NAMED_AREAS ? b.label : undefined,
      };
    });

    // Labelled dots where each year begins (or each month, within a year),
    // like the inspiration chart's "1900", "1950" — they're what makes the
    // trail readable as a timeline rather than a scribble.
    const anchors: (TrailPoint & { label: string })[] = [];
    let lastKey = "";
    for (const p of runs.flat()) {
      const key = singleYear ? p.date.slice(0, 7) : p.date.slice(0, 4);
      if (key === lastKey) continue;
      lastKey = key;
      anchors.push({ ...p, label: singleYear ? formatDate(`${key}-01`, "monthShort") : key });
    }
    // The present gets a labelled dot like a year's (owner's ask), so the
    // line visibly ends somewhere rather than trailing off. Only when the
    // view actually reaches the end of the record; a point sitting where a
    // recent year's dot already is merges into it as "2024–Now".
    const lastShown = runs[runs.length - 1]?.[runs[runs.length - 1].length - 1];
    if (lastShown && lastShown.date === endDate && anchors[anchors.length - 1]?.date !== lastShown.date) {
      anchors.push({ ...lastShown, label: "Now" });
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
    // whole line without a label every inch. Multi-year ranges only — in a
    // single year every month already has its own labelled dot.
    const pointMarkers: GeoMarker[] = [];
    if (!singleYear) {
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
  }, [current, runs, endDate, singleYear, colorOf, index, windowDays, selectedId]);

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

  // An area's colour comes from its all-time rank, so it's the same on
  // the map, in every tooltip's mix bar and in the breakdown panel,
  // whatever range is picked.
  const areaColor = useCallback((area: number) => areaColorForRank(data.areas[area].rank), [data]);
  const allTime = useMemo(() => rangeSummary(data, firstYear, lastYear), [data, firstYear, lastYear]);
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
      ...allTime.bases.filter((b) => b.share >= FRAME_MIN_SHARE).map((b) => b.position),
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
  }, [allTime, index]);

  // Names every coloured area, in rank order, so colour is never the only
  // way to tell which is which; the map labels them too.
  const legendSeries = useMemo(() => {
    const named = [...data.areas]
      .filter((a) => a.rank < NAMED_AREAS)
      .sort((a, b) => a.rank - b.rank)
      .map((a) => ({ id: a.key, label: a.label, color: areaColorForRank(a.rank) }));
    if (data.areas.length > named.length) named.push({ id: "other", label: "Elsewhere", color: AREA_OVERFLOW_COLOR });
    return named;
  }, [data]);

  const coverage = current.placedDays > 0 ? current.locatedDays / current.placedDays : 0;
  const rampFormat = (date: string) => formatDate(date, singleYear ? "short" : "monthYear");
  const rangeText = singleYear ? `in ${fromYear}` : wholeRecord ? "" : `from ${fromYear} to ${toYear}`;
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
          <YearRangePicker domain={yearDomain} value={[fromYear, toYear]} onChange={setPickedRange} />
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
            <span>Circles: areas, sized by share of days</span>
            <Legend series={legendSeries} className="w-full text-xs" />
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
                ariaLabel={`World map. A line traces the centre of mass of where I spent my days${rangeText ? ` ${rangeText}` : ""}, each point averaging the ${WINDOW_OPTIONS.find((o) => o.id === windowDays)!.label} before it, coloured from earliest to latest, with a labelled dot where each ${singleYear ? "month" : "year"} begins and one marking now. Shaded circles are the areas I spent time in, sized by their share of days, the ten largest coloured and named. Scroll or pinch to zoom, drag to pan. Hover a dot or circle for details; click a dot for a full breakdown.`}
              />
              {detail && selectedDate ? (
                <DetailPanel
                  detail={detail}
                  title={formatDate(selectedDate, "monthYear")}
                  windowLabel={WINDOW_OPTIONS.find((o) => o.id === windowDays)!.label}
                  windowDays={Number(windowDays)}
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
  windowDays,
  areas,
  colorOf,
  onClose,
  maxHeight,
}: {
  detail: WindowDetail;
  title: string;
  windowLabel: string;
  /** The window as picked, to tell when this one was cut short. */
  windowDays: number;
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
          {/* Only in the record's first windowDays: there isn't yet that
              much history behind the point (see windowBounds). Said
              outright, since the header above names the full window. */}
          {detail.spanDays < windowDays ? (
            <p className="text-muted-foreground">
              Cut to {formatSpan(detail.spanDays)}: the record starts {formatDate(detail.from, "dayYear")}
            </p>
          ) : null}
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

/** A day count as years and months, e.g. 967 -> "2 yr 8 mo". */
function formatSpan(days: number): string {
  const months = Math.round(days / 30.44);
  const [y, m] = [Math.floor(months / 12), months % 12];
  return [y > 0 ? `${y} yr` : null, m > 0 || y === 0 ? `${m} mo` : null].filter(Boolean).join(" ");
}
