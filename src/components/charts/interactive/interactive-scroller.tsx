"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { toDateString } from "@/lib/date";
import { formatDate, type DateFormatPreset } from "@/lib/viz/format";
import { categoricalColor } from "@/lib/viz/color";
import { drawStandardAxes, styleAxis } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { Legend, type LegendSeries } from "./legend";
import type { InteractiveLineRegion } from "./interactive-line";

// InteractiveScroller (#117) — a standalone primitive for raw, day-cadence
// series (every logged day gets its own point) with per-series rolling
// averages, always-on minimap + direct zoom/pan (kept in sync), point
// labels, and region bands. Deliberately NOT a preset over InteractiveLine
// (#18): that component already has a `zoom="direct"`/`"both"` mode and a
// `regions` prop covering much of the same ground, but per #117's own
// scoping note this is meant to diverge in its own direction over time
// rather than stay a thin skin over the grouped/aggregated-series
// primitive — InteractiveLine plays legacy's `Averager` role (pre-bucketed
// series, one point per month/week/whatever), this one plays legacy's
// `InteractiveScroller` role (raw daily density). Some mechanics below (the
// direct-zoom effect pair, the minimap strip) are intentionally
// near-duplicates of InteractiveLine's own — see that file's comments for
// the reasoning behind each, not re-explained twice here.
//
// This file's design was worked out directly against the real legacy
// implementation (functions/views/vis/vis_functions.js:965,
// InteractiveScroller) rather than guessed — see individual comments below
// for what was ported faithfully vs. deliberately simplified, and why.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const MINIMAP_HEIGHT = 56; // strip itself
const MINIMAP_AXIS_HEIGHT = 20; // its own bottom x-axis, per #117 follow-up
const LEGEND_HEIGHT = 28;
const MIN_MAIN_HEIGHT = 160;
const DEFAULT_MOVING_AVERAGE_WINDOW = 30; // legacy's movingAverageSize default
// A wash, never a saturated block — matches MARK_SPECS.area.fillOpacity
// (this app's general "translucent area" convention) rather than legacy's
// own 0.25, which reads too strong against this app's darker palette.
const REGION_OPACITY = MARK_SPECS.area.fillOpacity;
// Vertical gap between stacked region-label rows (see computeRegionDepths)
// and, separately, the (x,y) box a point label needs clearance from its
// neighbors — both rough, no real text-metrics measurement available
// outside a DOM/canvas pass, same tradeoff every d3 label-collision
// approximation in this codebase makes.
const REGION_LABEL_ROW_HEIGHT = 14;

export type InteractiveScrollerPoint = {
  x: Date;
  y: number;
  /** Optional annotation for this exact point (most commonly a "reason"
   * free-text field, e.g. happiness's) — rendered near the point on the
   * chart when there's room (see computeLabelPlacements), and always
   * surfaced in the tooltip regardless of whether the on-chart text won.
   * Legacy's own label-placement engine (vis_functions.js ~L1817) tries 4
   * candidate anchors per point with exact text-width clearance checks
   * against neighboring values, then runs a full pairwise overlap
   * resolution pass across every visible label. This primitive
   * deliberately does NOT port that exactly — see computeLabelPlacements'
   * own comment for the simplified heuristic used instead. */
  label?: string;
};

export type InteractiveScrollerSeries = {
  id: string;
  label: string;
  /** Defaults to `categoricalColor(i)` by this series' index. */
  color?: string;
  points: InteractiveScrollerPoint[];
  /** Opts this series into the shared `movingAverageWindow` overlay — one
   * window size for every opted-in series, toggled together via a single
   * combined "N-day average" legend entry (not a per-series toggle),
   * matching legacy's own single `movingAverageShow` switch and its
   * pluralized "Moving Average(s)" legend label. The average line reuses
   * THIS series' own color, dashed, rather than a second categorical
   * color — same call legacy makes (`movingAverageDashArray`) — and the
   * raw line fades to half-opacity while its average is shown, so the
   * dashed average reads as the primary signal without losing the raw
   * detail underneath. */
  movingAverage?: boolean;
};

/** Re-exported under this primitive's own name rather than redefined —
 * per #117's own scoping note, sharing InteractiveLine's region shape (even
 * though the two primitives render regions with separate code) means one
 * region dataset can feed either without reshaping. */
export type InteractiveScrollerRegion = InteractiveLineRegion;

export type InteractiveScrollerProps = {
  series: InteractiveScrollerSeries[];
  width: number;
  height: number;
  movingAverageWindow?: number;
  regions?: InteractiveScrollerRegion[];
  yDomain?: [number, number];
  yTickFormat?: (value: d3.NumberValue) => string;
  valueFormat?: (value: number) => string;
  dateFormat?: DateFormatPreset;
  margin?: Partial<typeof DEFAULT_MARGIN>;
  ariaLabel?: string;
};

type ResolvedSeries = InteractiveScrollerSeries & { color: string };

/** Trailing average over the `window` most recent points by index (not by
 * calendar day span) — a personal daily log can have gaps (a day never
 * logged), and legacy's own `movingAverageSize` is a point count, not a
 * day-span. The first `window - 1` entries average over however many
 * points actually exist so far (a ramping partial average) rather than
 * staying undefined until the window fully fills — same call as legacy,
 * which shows a (noisier) average from the very first point rather than
 * leaving a gap at the start of the series. */
export function computeMovingAverage(points: InteractiveScrollerPoint[], window: number): InteractiveScrollerPoint[] {
  if (window <= 1) return points.map((p) => ({ ...p }));
  const result: InteractiveScrollerPoint[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].y;
    if (i >= window) sum -= points[i - window].y;
    const count = Math.min(i + 1, window);
    result.push({ x: points[i].x, y: sum / count });
  }
  return result;
}

/** Assigns each region a "depth" (0, 1, 2, ...) — a row it can occupy
 * without visually colliding with another region that overlaps it in
 * time — the same greedy interval-stacking legacy's `calculateRegionLabels`
 * does (its "gaps" map), extracted here as its own pure/testable step and
 * shorn of legacy's dynamic one-line/two-line/alias text-fitting cascade
 * (see the region-label rendering in the main component for what replaces
 * that). Two regions that never overlap in time can share depth 0; a
 * region nested inside another (an "occupation" band inside a wider
 * "residence" band) gets depth 1, and so on. */
export function computeRegionDepths<R extends { start: Date; end: Date }>(regions: R[]): (R & { depth: number })[] {
  const sorted = [...regions].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: (R & { depth: number })[] = [];
  for (const region of sorted) {
    const activeDepths = new Set(
      result.filter((r) => r.end.getTime() > region.start.getTime()).map((r) => r.depth),
    );
    let depth = 0;
    while (activeDepths.has(depth)) depth++;
    result.push({ ...region, depth });
  }
  return result;
}

/** Rough average-character-width estimate — no canvas/DOM text
 * measurement available at this layer (this runs inside a d3 render pass,
 * not a React render), same tradeoff legacy's own `textWidthRatio` lookup
 * table makes, just cruder (a flat ratio instead of a per-character
 * table). Only used to decide "does this label roughly fit," never to
 * position text pixel-exactly. */
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

export type LabelCandidate = { id: string; pixelX: number; pixelY: number; text: string; color: string };
export type PlacedLabel = LabelCandidate & { above: boolean };
/** A rendered line's own pixel samples (raw + average, every visible
 * series) — what computeLabelPlacements checks a candidate box against so
 * a label doesn't just avoid other labels but also the data itself. Dense
 * enough (roughly one per day, per series) that checking a box against
 * the nearest samples is a good proxy for "does the actual curve pass
 * through here" without needing the real bezier/monotone path math. */
export type LineSample = { pixelX: number; pixelY: number };

/** Simplified stand-in for legacy's point-label placement engine
 * (vis_functions.js ~L1817-1955): that version tries 4 candidate anchors
 * per point (left/right x above/below) with exact width-based clearance
 * checks against every neighboring point's value, then runs a full
 * pairwise overlap-resolution pass across all visible labels, retrying
 * each candidate's remaining options before finally hiding it. This
 * version keeps the same GOAL (show as many labels as will fit without
 * overlapping — the line, or each other — preferring above the point)
 * with much simpler mechanics: sort candidates left-to-right, try "above"
 * then "below" against only the labels already accepted so far plus the
 * line samples themselves, hide if neither fits. Good enough for a
 * personal-log's sparse "has a reason" points (this only ever runs over
 * points that actually have a `label`, not the full daily series), not a
 * pixel-identical port. */
export function computeLabelPlacements(
  candidates: LabelCandidate[],
  fontSize: number,
  lineSamples: LineSample[] = [],
): PlacedLabel[] {
  const sorted = [...candidates].sort((a, b) => a.pixelX - b.pixelX);
  const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
  const placed: PlacedLabel[] = [];
  const halfWidth = (text: string) => estimateTextWidth(text, fontSize) / 2;
  const gap = 4;
  const boxHeight = fontSize + gap;

  const overlapsBox = (box: { left: number; right: number; top: number; bottom: number }, other: { left: number; right: number; top: number; bottom: number }) =>
    !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom);

  for (const c of sorted) {
    const hw = halfWidth(c.text);
    const left = c.pixelX - hw;
    const right = c.pixelX + hw;
    for (const above of [true, false]) {
      const top = above ? c.pixelY - boxHeight - gap : c.pixelY + gap;
      const bottom = top + boxHeight;
      const box = { left, right, top, bottom };
      const overlapsOtherLabel = boxes.some((b) => overlapsBox(box, b));
      const overlapsLine = lineSamples.some((s) => s.pixelX >= left && s.pixelX <= right && s.pixelY >= top && s.pixelY <= bottom);
      if (!overlapsOtherLabel && !overlapsLine) {
        boxes.push(box);
        placed.push({ ...c, above });
        break;
      }
    }
  }
  return placed;
}

function resolveSeriesColors(series: InteractiveScrollerSeries[]): ResolvedSeries[] {
  return series.map((s, i) => ({ ...s, color: s.color ?? categoricalColor(i) }));
}

function domainsRoughlyEqual(a: [Date, Date] | null, b: [Date, Date]): boolean {
  if (!a) return false;
  return Math.abs(a[0].getTime() - b[0].getTime()) < 1000 && Math.abs(a[1].getTime() - b[1].getTime()) < 1000;
}

function allPixelPositions(series: ResolvedSeries[], x: d3.ScaleTime<number, number>): number[] {
  const set = new Set<number>();
  for (const s of series) for (const p of s.points) set.add(x(p.x));
  return Array.from(set).sort((a, b) => a - b);
}

/** Shared-x, per-series-independent crosshair — same shape as
 * InteractiveLine's own `useLineCrosshair` (one pixel X, each series
 * bisects into its own points for its nearest value), duplicated locally
 * rather than extracted into the shared toolkit since #117 keeps this
 * primitive's mechanics independent of InteractiveLine's — see this file's
 * header comment. */
function useScrollerCrosshair(series: ResolvedSeries[], x: d3.ScaleTime<number, number>) {
  const [pixelX, setPixelX] = useState<number | null>(null);
  const positions = useMemo(() => allPixelPositions(series, x), [series, x]);

  const moveTo = (localX: number) => {
    if (positions.length === 0) return;
    setPixelX(positions[d3.bisectCenter(positions, localX)] ?? null);
  };

  const handlers = {
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => moveTo(event.nativeEvent.offsetX),
    onPointerLeave: () => setPixelX(null),
    onFocus: () => setPixelX((cur) => cur ?? (positions.length ? positions[positions.length - 1] : null)),
    onBlur: () => setPixelX(null),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (positions.length === 0) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPixelX((cur) => {
          const idx = cur === null ? positions.length : positions.indexOf(cur);
          return positions[Math.max(0, idx - 1)] ?? positions[0];
        });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPixelX((cur) => {
          const idx = cur === null ? -1 : positions.indexOf(cur);
          return positions[Math.min(positions.length - 1, idx + 1)] ?? positions[positions.length - 1];
        });
      } else if (event.key === "Escape") {
        setPixelX(null);
      }
    },
    tabIndex: 0,
  };

  const hoveredBySeries = useMemo<({ point: InteractiveScrollerPoint; index: number } | null)[]>(() => {
    if (pixelX === null) return series.map(() => null);
    return series.map((s) => {
      if (s.points.length === 0) return null;
      const seriesPositions = s.points.map((p) => x(p.x));
      const index = d3.bisectCenter(seriesPositions, pixelX);
      const point = s.points[index];
      return point ? { point, index } : null;
    });
  }, [series, x, pixelX]);

  return { pixelX, hoveredBySeries, handlers };
}

type ResolvedRegion = InteractiveScrollerRegion & { depth: number };

/** Bottom minimap strip — always plots every series' SMOOTHED line across
 * the FULL range, per legacy's own spec, regardless of whether that
 * series' average overlay is currently toggled off in the main plot (or
 * whether that series opted into an average at all): the minimap's job is
 * an at-a-glance shape of the whole history, and a smoothed line reads
 * better at that scale than a noisy raw one would — legacy computes this
 * unconditionally too (`means`, independent of `movingAverageShow`). Also
 * shows region bands (depth-inset, same idea as legacy's
 * `regionShowMinimap` nested rects) and its own bottom x-axis. Drag to set
 * the visible window; kept in sync with direct zoom/pan on the main plot
 * via `selection`/`onBrush`, same two-way pattern as InteractiveLine's
 * "both" zoom mode. */
function Minimap({
  smoothedSeries,
  regions,
  width,
  fullDomain,
  selection,
  onBrush,
}: {
  smoothedSeries: { color: string; points: InteractiveScrollerPoint[] }[];
  regions: ResolvedRegion[];
  width: number;
  fullDomain: [Date, Date];
  selection: [Date, Date] | null;
  onBrush: (domain: [Date, Date] | null) => void;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - DEFAULT_MARGIN.left - DEFAULT_MARGIN.right;
      const innerHeight = MINIMAP_HEIGHT - 8;

      const x = d3.scaleTime().domain(fullDomain).range([0, innerWidth]);
      const allPoints = smoothedSeries.flatMap((s) => s.points);
      const yExtent = d3.extent(allPoints, (p) => p.y) as [number, number];
      const y = d3
        .scaleLinear()
        .domain(yExtent[0] === undefined ? [0, 1] : yExtent)
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", MINIMAP_HEIGHT + MINIMAP_AXIS_HEIGHT)
        .append("g")
        .attr("transform", `translate(${DEFAULT_MARGIN.left},4)`);

      for (const region of regions) {
        const rx0 = Math.max(0, x(region.start));
        const rx1 = Math.min(innerWidth, x(region.end));
        if (rx1 <= rx0) continue;
        // Depth-inset from both edges (legacy's nested-rect minimap
        // treatment) rather than a separate row per depth — at minimap
        // scale there's no room for per-row labels anyway, so this just
        // needs to communicate "these overlap," not read individually.
        const inset = region.depth * 3;
        g.append("rect")
          .attr("x", rx0)
          .attr("y", inset)
          .attr("width", rx1 - rx0)
          .attr("height", Math.max(2, innerHeight - inset * 2))
          .attr("fill", region.color ?? "var(--muted-foreground)")
          .attr("fill-opacity", REGION_OPACITY * (1 + region.depth * 0.5));
      }

      const line = d3
        .line<InteractiveScrollerPoint>()
        .x((d) => x(d.x))
        .y((d) => y(d.y))
        .curve(d3.curveMonotoneX);

      for (const s of smoothedSeries) {
        g.append("path").datum(s.points).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 1.5).attr("d", line);
      }

      const axisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
      styleAxis(axisG, d3.axisBottom(x).ticks(Math.max(2, Math.floor(innerWidth / 90))));

      const brush = d3
        .brushX()
        .extent([
          [0, 0],
          [innerWidth, innerHeight],
        ])
        .on("brush end", (event: d3.D3BrushEvent<unknown>) => {
          // `event.sourceEvent` is only set for a REAL user gesture (mouse/
          // touch) — d3-brush also fires this same "brush"/"end" dispatch
          // for the programmatic `brush.move(...)` call a few lines below
          // (used to keep this strip's own handles in sync when the domain
          // changes via direct zoom/pan on the main plot instead). Without
          // this guard, that sync call re-invokes this handler, which calls
          // onBrush, which updates the parent's visibleDomain state, which
          // re-renders this component with a new `selection` prop, which
          // re-runs this whole effect and calls `.move()` again — an
          // infinite render loop (found live: panning the main plot
          // crashed the page with "Maximum update depth exceeded").
          if (!event.sourceEvent) return;
          if (!event.selection) {
            onBrush(null);
            return;
          }
          const [x0, x1] = event.selection as [number, number];
          onBrush([x.invert(x0), x.invert(x1)]);
        });

      const brushG = g.append("g").call(brush);
      if (selection) {
        brushG.call(brush.move, [x(selection[0]), x(selection[1])]);
      }
      // The brush selection reads as "this chart's own zoomed window," so
      // it takes the PRIMARY (first) series' own color — weight's violet,
      // happiness's green — rather than a hardcoded chart-1, which read as
      // an unrelated accent on any chart whose first series isn't chart-1
      // (violet weight, most obviously).
      const brushColor = smoothedSeries[0]?.color ?? "var(--chart-1)";
      brushG.selectAll(".selection").attr("fill", brushColor).attr("fill-opacity", 0.15).attr("stroke", brushColor);
    },
    // `onBrush` deliberately excluded — see InteractiveLine's Overview for
    // why (would rebuild the brush, and drop an in-progress drag, on every
    // state update the brush itself causes).
    [smoothedSeries, regions, width, fullDomain[0].getTime(), fullDomain[1].getTime(), selection?.[0]?.getTime(), selection?.[1]?.getTime()],
  );

  return <svg ref={ref} />;
}

export function InteractiveScroller({
  series,
  width,
  height,
  movingAverageWindow = DEFAULT_MOVING_AVERAGE_WINDOW,
  regions = [],
  yDomain,
  yTickFormat,
  valueFormat = String,
  dateFormat = "weekday",
  margin,
  ariaLabel,
}: InteractiveScrollerProps) {
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };
  const clipId = useId().replace(/[:]/g, "");

  const resolvedSeries = useMemo(
    () =>
      resolveSeriesColors(series).map((s) => ({
        ...s,
        points: [...s.points].sort((a, b) => a.x.getTime() - b.x.getTime()),
      })),
    [series],
  );

  // Every series' smoothed line, computed unconditionally (the minimap
  // always wants one — see Minimap's own comment) — `series.movingAverage`
  // only gates whether the MAIN plot renders this as a visible dashed
  // overlay, not whether it's computed at all.
  const averagesById = useMemo(() => {
    const map = new Map<string, InteractiveScrollerPoint[]>();
    for (const s of resolvedSeries) map.set(s.id, computeMovingAverage(s.points, movingAverageWindow));
    return map;
  }, [resolvedSeries, movingAverageWindow]);

  const seriesWithAverage = resolvedSeries.filter((s) => s.movingAverage);
  const averageLegendLabel =
    seriesWithAverage.length > 0
      ? `${movingAverageWindow}-day average${seriesWithAverage.length > 1 ? "s" : ""}`
      : null;

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const showAverageOverlay = !hiddenIds.has("average");
  const visibleSeries = resolvedSeries.filter((s) => !hiddenIds.has(s.id));

  const fullXDomain = useMemo<[Date, Date]>(() => {
    const allX = resolvedSeries.flatMap((s) => s.points.map((p) => p.x));
    const extent = d3.extent(allX);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : [new Date(), new Date()];
  }, [resolvedSeries]);

  const [visibleDomain, setVisibleDomain] = useState<[Date, Date] | null>(null);
  const effectiveDomain = visibleDomain ?? fullXDomain;

  const legendReserve = LEGEND_HEIGHT;
  const minimapReserve = MINIMAP_HEIGHT + MINIMAP_AXIS_HEIGHT;
  const mainHeight = Math.max(MIN_MAIN_HEIGHT, height - legendReserve - minimapReserve);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = mainHeight - MARGIN.top - MARGIN.bottom;

  const x = useMemo(() => d3.scaleTime().domain(effectiveDomain).range([0, innerWidth]), [effectiveDomain, innerWidth]);

  const visibleBySeriesId = useMemo(() => {
    const map = new Map<string, InteractiveScrollerPoint[]>();
    for (const s of visibleSeries) {
      map.set(
        s.id,
        s.points.filter((p) => p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1]),
      );
    }
    return map;
  }, [visibleSeries, effectiveDomain]);

  const resolvedYDomain = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    const values: number[] = [];
    for (const s of visibleSeries) {
      for (const p of visibleBySeriesId.get(s.id) ?? []) values.push(p.y);
      if (s.movingAverage && showAverageOverlay) {
        const avg = averagesById.get(s.id) ?? [];
        for (const p of avg) {
          if (p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1]) values.push(p.y);
        }
      }
    }
    const [lo, hi] = d3.extent(values.length ? values : [0, 1]) as [number, number];
    const pad = (hi - lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }, [yDomain, visibleSeries, visibleBySeriesId, averagesById, showAverageOverlay, effectiveDomain]);

  const y = useMemo(() => d3.scaleLinear().domain(resolvedYDomain).range([innerHeight, 0]), [resolvedYDomain, innerHeight]);

  const crosshair = useScrollerCrosshair(visibleSeries, x);

  const overlayRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<{
    behavior: d3.ZoomBehavior<HTMLDivElement, unknown>;
    selection: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  } | null>(null);

  // Direct zoom/pan — always on for this primitive (unlike InteractiveLine,
  // where it's one of several opt-in `zoom` modes). See InteractiveLine's
  // identical effect for the full reasoning (rescaling from a fixed base
  // scale, why fullXDomain not `x` is the dependency).
  //
  // Double-click-to-reset is wired via a real React `onDoubleClick` prop
  // below (on the overlay div), NOT via d3's own `selection.on("dblclick",
  // ...)` the way InteractiveLine's identical effect does — that pattern
  // crashes React 19's dev-mode event system ("unknown type: dblclick",
  // thrown from inside react-dom) the moment a d3-attached native listener
  // and React's synthetic event delegation share the same node. Found while
  // building this component (InteractiveLine's zoom="direct"/"both" modes
  // were never actually wired into a production chart yet — see AGENTS.md —
  // so this never got exercised there either). Disabling d3-zoom's OWN
  // default dblclick-to-zoom-in behavior is done on the SELECTION after
  // `.call(behavior)` below (`selection.on("dblclick.zoom", null)`), not on
  // the zoom generator itself — a second bug found alongside the first:
  // the generator's own `.on()` is d3-dispatch, which only recognizes
  // "start"/"zoom"/"end" for a zoom behavior, so calling
  // `.on("dblclick.zoom", null)` there (as InteractiveLine's own identical
  // effect does) throws d3-dispatch's "unknown type: dblclick" — the
  // dblclick.zoom *selection* binding d3-zoom installs when applied is a
  // separate mechanism from the generator's own dispatcher.
  //
  // Mouse-wheel-to-zoom (issue follow-up: "scrolling while hovering over
  // the chart should zoom") needs no extra code — d3.zoom listens for
  // wheel events on the element it's applied to by default. Deliberately
  // NOT also attached to the minimap: per design discussion, the minimap
  // stays a fixed overview you only interact with by dragging its brush,
  // not a second zoom surface.
  useEffect(() => {
    const node = overlayRef.current;
    if (!node) return;

    const baseX = d3.scaleTime().domain(fullXDomain).range([0, innerWidth]);

    const behavior = d3
      .zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, 64])
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .on("zoom", (event: d3.D3ZoomEvent<HTMLDivElement, unknown>) => {
        const rescaled = event.transform.rescaleX(baseX);
        let [d0, d1] = rescaled.domain() as [Date, Date];
        if (d0 <= fullXDomain[0] && d1 >= fullXDomain[1]) {
          setVisibleDomain((cur) => (cur === null ? cur : null));
          return;
        }
        if (d0 < fullXDomain[0]) d0 = fullXDomain[0];
        if (d1 > fullXDomain[1]) d1 = fullXDomain[1];
        if (d1 <= d0) return;
        setVisibleDomain((cur) => (domainsRoughlyEqual(cur, [d0, d1]) ? cur : [d0, d1]));
      });

    const selection = d3.select(node).call(behavior).on("dblclick.zoom", null);
    zoomRef.current = { behavior, selection };

    return () => {
      selection.on(".zoom", null);
      zoomRef.current = null;
    };
  }, [innerWidth, innerHeight, fullXDomain]);

  const handleResetZoom = () => {
    if (!zoomRef.current) return;
    zoomRef.current.selection.call(zoomRef.current.behavior.transform, d3.zoomIdentity);
    setVisibleDomain(null);
  };

  // Keeps d3-zoom's own transform in sync when the domain changes via the
  // minimap's brush instead of direct zoom — see InteractiveLine's
  // identical effect for why this is needed.
  useEffect(() => {
    if (!zoomRef.current) return;
    const { behavior, selection } = zoomRef.current;
    const baseX = d3.scaleTime().domain(fullXDomain).range([0, innerWidth]);
    const domain = visibleDomain ?? fullXDomain;
    const spanPx = baseX(domain[1]) - baseX(domain[0]);
    if (spanPx <= 0) return;
    const k = innerWidth / spanPx;
    const tx = -baseX(domain[0]) * k;
    selection.call(behavior.transform, d3.zoomIdentity.translate(tx, 0).scale(k));
  }, [visibleDomain, fullXDomain, innerWidth]);

  const resolvedRegions = useMemo(() => computeRegionDepths(regions), [regions]);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", mainHeight);

      // Requirement #6: clip the plot area so a line/marker/region never
      // paints past the axes — legacy does the exact same thing
      // (vis_functions.js's own `clipPath` around its main-plot group).
      svg
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", innerWidth)
        .attr("height", innerHeight);

      const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
      const clipped = g.append("g").attr("clip-path", `url(#${clipId})`);

      for (const region of resolvedRegions) {
        const rx0 = Math.max(0, x(region.start));
        const rx1 = Math.min(innerWidth, x(region.end));
        if (rx1 <= rx0) continue;
        clipped
          .append("rect")
          .attr("x", rx0)
          .attr("y", 0)
          .attr("width", rx1 - rx0)
          .attr("height", innerHeight)
          .attr("fill", region.color ?? "var(--muted-foreground)")
          .attr("fill-opacity", REGION_OPACITY);
        // Depth-stacked label rows (requirement #5) — a region nested
        // inside a wider one gets its label one row below the outer
        // region's, instead of the two texts overlapping.
        const labelX = Math.max(rx0, 0) + 4;
        const availableWidth = rx1 - Math.max(rx0, 0) - 8;
        const label = region.label;
        if (availableWidth > estimateTextWidth(label, 11)) {
          clipped
            .append("text")
            .attr("x", labelX)
            .attr("y", 12 + region.depth * REGION_LABEL_ROW_HEIGHT)
            .attr("fill", "var(--muted-foreground)")
            .style("font-size", MARK_SPECS.axis.tickFontSize)
            .text(label);
        }
      }

      drawStandardAxes({ g, x, y, innerWidth, innerHeight, yTicks: 5, yTickFormat });

      const lineGen = d3
        .line<InteractiveScrollerPoint>()
        .x((d) => x(d.x))
        .y((d) => y(d.y))
        .curve(d3.curveMonotoneX);

      const labelCandidates: LabelCandidate[] = [];
      const lineSamples: LineSample[] = [];
      const labelPadMs = (effectiveDomain[1].getTime() - effectiveDomain[0].getTime()) * 0.1;

      for (const s of visibleSeries) {
        const visiblePoints = visibleBySeriesId.get(s.id) ?? [];
        const showAvg = s.movingAverage && showAverageOverlay;
        for (const p of visiblePoints) lineSamples.push({ pixelX: x(p.x), pixelY: y(p.y) });

        clipped
          .append("path")
          .datum(visiblePoints)
          .attr("fill", "none")
          .attr("stroke", s.color)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("stroke-opacity", showAvg ? 0.5 : 1)
          .attr("d", lineGen);

        if (visiblePoints.length < 150) {
          clipped
            .selectAll(null)
            .data(visiblePoints)
            .join("circle")
            .attr("cx", (d) => x(d.x))
            .attr("cy", (d) => y(d.y))
            .attr("r", MARK_SPECS.marker.radius)
            .attr("fill", s.color)
            .attr("fill-opacity", showAvg ? 0.5 : 1)
            .attr("stroke", "var(--card)")
            .attr("stroke-width", MARK_SPECS.marker.ringWidth);
        }

        if (showAvg) {
          const avgVisible = (averagesById.get(s.id) ?? []).filter(
            (p) => p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1],
          );
          clipped
            .append("path")
            .datum(avgVisible)
            .attr("fill", "none")
            .attr("stroke", s.color)
            .attr("stroke-width", MARK_SPECS.line.strokeWidth)
            .attr("stroke-dasharray", "5,5")
            .attr("d", lineGen);
          for (const p of avgVisible) lineSamples.push({ pixelX: x(p.x), pixelY: y(p.y) });
        }

        // Requirement #4 — gather this series' labeled points (padded
        // slightly past the visible window so a label doesn't pop in/out
        // abruptly right at the edge) as placement candidates.
        for (const p of s.points) {
          if (!p.label) continue;
          if (p.x.getTime() < effectiveDomain[0].getTime() - labelPadMs) continue;
          if (p.x.getTime() > effectiveDomain[1].getTime() + labelPadMs) continue;
          labelCandidates.push({ id: `${s.id}-${p.x.getTime()}`, pixelX: x(p.x), pixelY: y(p.y), text: p.label, color: s.color });
        }
      }

      const placedLabels = computeLabelPlacements(labelCandidates, 11, lineSamples);
      for (const l of placedLabels) {
        clipped
          .append("text")
          .attr("x", l.pixelX)
          .attr("y", l.above ? l.pixelY - 8 : l.pixelY + 15)
          .attr("text-anchor", "middle")
          .attr("fill", "var(--foreground)")
          .style("font-size", "11px")
          .text(l.text);
      }
    },
    [
      clipId,
      resolvedRegions,
      width,
      mainHeight,
      x,
      y,
      yTickFormat,
      innerWidth,
      innerHeight,
      visibleSeries,
      visibleBySeriesId,
      averagesById,
      showAverageOverlay,
      effectiveDomain,
    ],
  );

  const tooltipRows: TooltipRow[] = [];
  let tooltipAnchorY: number | null = null;
  let tooltipTitleDate: Date | null = null;
  let closestTitleDistance = Infinity;
  for (const [i, s] of visibleSeries.entries()) {
    const hovered = crosshair.hoveredBySeries[i];
    if (!hovered) continue;
    // The shared crosshair snaps to ONE pixel position, but each series
    // independently bisects to ITS OWN nearest point (useScrollerCrosshair
    // above) — a sparse series (body fat logged every few days) and a
    // dense one (weight logged nearly daily) can resolve to different
    // real calendar dates at the same cursor position. The title has to
    // reflect whichever series' point is actually closest to the cursor,
    // not just whichever series happens to be first in the array —
    // otherwise hovering directly over one series' own data point (an
    // outlier spike, say) can show that point's correct VALUE under a
    // different, merely-nearby series' DATE. Found live: an April 2020
    // body-fat outlier, on a day weight wasn't also logged, showed the
    // right value under the wrong (nearest weight-log) date.
    const distance = crosshair.pixelX === null ? Infinity : Math.abs(x(hovered.point.x) - crosshair.pixelX);
    if (distance < closestTitleDistance) {
      closestTitleDistance = distance;
      tooltipTitleDate = hovered.point.x;
    }
    tooltipRows.push({ label: s.label, value: valueFormat(hovered.point.y), color: s.color });
    tooltipAnchorY = tooltipAnchorY === null ? y(hovered.point.y) : (tooltipAnchorY + y(hovered.point.y)) / 2;
    if (s.movingAverage && showAverageOverlay) {
      const avgPoint = (averagesById.get(s.id) ?? [])[hovered.index];
      if (avgPoint) tooltipRows.push({ label: `${s.label} avg`, value: valueFormat(avgPoint.y), color: s.color });
    }
    if (hovered.point.label) {
      tooltipRows.push({ label: `${s.label} note`, value: hovered.point.label, color: s.color });
    }
  }

  const legendSeries: LegendSeries[] = [
    ...resolvedSeries.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    ...(averageLegendLabel ? [{ id: "average", label: averageLegendLabel, color: "var(--muted-foreground)" }] : []),
  ];

  return (
    <div style={{ position: "relative", width, height }}>
      <Legend
        series={legendSeries}
        className="mb-1.5"
        onToggle={(id) => {
          setHiddenIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        hiddenIds={hiddenIds}
      />
      <div style={{ position: "relative", width, height: mainHeight }}>
        <svg ref={ref} />
        <div
          ref={overlayRef}
          className="absolute"
          style={{ left: MARGIN.left, top: MARGIN.top, width: innerWidth, height: innerHeight, cursor: "grab" }}
          role="img"
          aria-label={ariaLabel ?? "Interactive chart. Use arrow keys to inspect data points, or hover to see values."}
          onDoubleClick={handleResetZoom}
          {...crosshair.handlers}
        >
          {crosshair.pixelX !== null ? (
            <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 w-px bg-border" style={{ left: crosshair.pixelX }} />
          ) : null}
        </div>
        {tooltipRows.length > 0 && crosshair.pixelX !== null && tooltipTitleDate && tooltipAnchorY !== null ? (
          <ChartTooltip
            x={MARGIN.left + crosshair.pixelX}
            y={MARGIN.top + tooltipAnchorY}
            title={formatDate(toDateString(tooltipTitleDate), dateFormat)}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
      <Minimap
        smoothedSeries={resolvedSeries.map((s) => ({ color: s.color, points: averagesById.get(s.id) ?? [] }))}
        regions={resolvedRegions}
        width={width}
        fullDomain={fullXDomain}
        selection={visibleDomain}
        onBrush={setVisibleDomain}
      />
    </div>
  );
}
