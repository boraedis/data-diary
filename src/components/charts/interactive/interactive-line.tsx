"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { toDateString } from "@/lib/date";
import { formatDate, type DateFormatPreset } from "@/lib/viz/format";
import { categoricalColor } from "@/lib/viz/color";
import { drawStandardAxes } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { Legend, useLegendHeight } from "./legend";
import { drawReferenceLines, NO_REFERENCE_LINES, referenceLineValues, type ReferenceLine } from "./reference-lines";
import { padDomain } from "@/lib/viz/domain";
import {
  placePointLabels,
  pointPriorities,
  pointsSparseEnough,
  preferredSide,
  spreadEndLabels,
  type PointLabelCandidate,
} from "@/lib/viz/line-labels";

// Click-to-toggle legend (`hiddenIds`/`onToggle`) added for the Exercise
// Trend chart's category/exercise breakdown (#411) — the same pattern
// InteractiveScroller/InteractiveArea already have, generalized to this
// primitive rather than left as the one Interactive* without it. A hidden
// series is dropped everywhere below (domain, crosshair, overview, the
// plot itself) as if it weren't passed at all; only the legend still lists
// it, dimmed, so it can be toggled back on.

// InteractiveLine (#18) — the shared time-series primitive that replaces
// three overlapping legacy constructors (Scroller, Averager, TimeLine) and
// generalizes this repo's two one-off implementations
// (WeightScrollerChart, HappinessTrendChart — now thin wrappers around
// this) into one composable component. See issue #18 for the full spec;
// this file's own doc comments cover the *why* behind each design choice
// below.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
// Overview strip and legend both reserve a small fixed slice of the total
// height budget (passed in from ResponsiveChart) before the main plot gets
// whatever's left — the same "subtract fixed chrome, floor the remainder"
// approach WeightScrollerChart used pre-#18 for its overview strip alone.
// The legend's slice is measured once it renders (`useLegendHeight`), since
// a long one wraps; LEGEND_HEIGHT is only its one-row starting guess.
const OVERVIEW_HEIGHT = 64;
const LEGEND_HEIGHT = 28;
const MIN_MAIN_HEIGHT = 160;

// On-chart labels (#110). See `lineLabels`/`pointLabels` on the props for
// when each is drawn.
const LABEL_FONT_SIZE = 11;
/** Line height used for both kinds of label's collision box, px. */
const LABEL_HEIGHT = 14;
const MAX_AUTO_LINE_LABELS = 6;
const MAX_AUTO_POINT_LABEL_SERIES = 2;
/** Below this total width, "auto" line labels give their gutter back to
 * the plot and leave naming to the legend. */
const MIN_LINE_LABEL_WIDTH = 480;
/** The gutter never takes more than this share of the width; longer names
 * are cut short with an ellipsis. */
const MAX_GUTTER_SHARE = 0.25;
const GUTTER_PAD = 8;
/** A drag shorter than this is a click, not a selection, px. */
const MIN_SELECT_PX = 6;

let measureNode: SVGTextElement | null | undefined;
/** Labels repeat ("7.2" in many months), and each measurement forces a
 * layout, so widths are remembered per text and weight. */
const measured = new Map<string, number>();
/** Narrower than any digit or letter at 11px, so `text.length` times this
 * is a width no real rendering comes in under. Used to reject a dense
 * series before measuring any of its labels. */
const MIN_CHAR_WIDTH = 4;

/**
 * Rendered width of `text` at the labels' size, px. The gutter for line
 * labels has to be known before the x scale is built, which is before this
 * chart's own `<svg>` exists to measure into, so this measures in one
 * shared, hidden `<svg>` on the page, inheriting the page's font as the
 * real labels do. Where SVG text can't be measured (jsdom, which has no
 * layout to be right about anyway), it estimates from the character count.
 */
function measureLabel(text: string, weight: 400 | 600 = 400): number {
  if (measureNode === undefined) {
    measureNode = null;
    if (typeof document !== "undefined") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
      const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.style.fontSize = `${LABEL_FONT_SIZE}px`;
      svg.appendChild(node);
      document.body.appendChild(svg);
      if (typeof node.getComputedTextLength === "function") measureNode = node;
      else svg.remove();
    }
  }
  if (!measureNode) return text.length * LABEL_FONT_SIZE * (weight === 600 ? 0.62 : 0.58);
  const key = `${weight}:${text}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  measureNode.style.fontWeight = String(weight);
  measureNode.textContent = text;
  const width = measureNode.getComputedTextLength();
  measured.set(key, width);
  return width;
}

/** `text`, cut to fit `maxWidth` with an ellipsis if it doesn't. */
function fitLabel(text: string, maxWidth: number, weight: 400 | 600): string {
  if (measureLabel(text, weight) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measureLabel(`${cut}…`, weight) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export type InteractiveLinePoint = {
  x: Date;
  y: number;
  /** Band bounds around this point (min/max, mean±stdev — caller decides
   * what the bounds mean); rendered as a translucent area behind the line
   * when the series' own `band` flag is set. Points without both bounds
   * set are simply excluded from the band path — the line itself still
   * draws for every point either way. */
  bandLow?: number;
  bandHigh?: number;
};

export type InteractiveLineSeries = {
  id: string;
  label: string;
  /** Defaults to `categoricalColor(i)` (fixed slot order, per the dataviz
   * skill's non-negotiable) using this series' index in `series` — pass
   * this explicitly only when a caller needs a specific slot regardless of
   * array order (e.g. a series that can be toggled out, so its color
   * shouldn't shift when a sibling disappears). */
  color?: string;
  points: InteractiveLinePoint[];
  /** Point markers. `true` draws every point at the toolkit's default mark
   * spec (>=8px diameter, surface ring). A function sizes each marker
   * individually instead — e.g. HappinessTrendChart's "bigger dot = more
   * days fed this average" — and is NOT clamped to the spec's minimum,
   * since the whole point of a variable radius is to also go smaller for
   * lower-confidence points; the spec minimum is only the *default*, not a
   * floor on every mode. */
  markers?: boolean | ((point: InteractiveLinePoint, index: number) => number);
  /** Render `bandLow`/`bandHigh` as a translucent area behind this series'
   * line (legacy Averager's band; TrendExplorer feeds it ±1 std dev). Only
   * actually drawn while exactly one series is visible at once (toggling
   * others off via the legend, or there simply being only one to begin
   * with) — overlapping translucent bands from several simultaneously
   * visible series read as mud, not signal, so this flag means "eligible
   * for a band," and the component itself decides when showing one is
   * legible. */
  band?: boolean;
  /** Per-point tooltip row label, overriding this series' own `label` for
   * that one row — e.g. HappinessTrendChart's "12 days" sample-size
   * caption in place of repeating "Happiness" on every row. Defaults to
   * the fixed series `label` (also what the legend shows). */
  tooltipLabel?: (point: InteractiveLinePoint, index: number) => string;
};

export type InteractiveLineRegion = {
  start: Date;
  end: Date;
  label: string;
  color?: string;
};

/**
 * - "none": static plot, no zoom affordance (hover crosshair still works).
 * - "brush": a mini overview strip below the plot; drag to select the
 *   visible range (WeightScrollerChart's pre-#18 pattern).
 * - "direct": scroll/drag directly on the plot itself, matching legacy
 *   InteractiveScroller.
 * - "both": both at once, kept in sync — dragging the overview strip moves
 *   the main plot's domain and vice versa.
 */
export type InteractiveLineZoom = "none" | "brush" | "direct" | "both";

/**
 * What hovering reads out.
 *
 * - "x" (default): the shared crosshair — snap to the nearest x, list every
 *   visible series' value there. Right for a handful of lines, where the
 *   comparison at one moment is the question.
 * - "series": the one line nearest the pointer. It's drawn on top at full
 *   strength, every other line fades, and the tooltip names just that
 *   series. Built for the People Impact Trend chart, which draws thirty to
 *   sixty lines at once in shared tag colours: there an x-slice tooltip is
 *   a sixty-row list, and colour can't say which line is whose, so "which
 *   line is this" has to be answered by pointing at it. This is #110's
 *   "hover prioritizes the series" item. It's scoped as an opt-in mode on
 *   this primitive rather than a change to the shared `useCrosshair`,
 *   because picking a line needs each series' own points, which only this
 *   primitive has. It stays off by default so every existing line chart
 *   reads exactly as before. Nearest is measured vertically at the snapped
 *   x, among series that have a point there — hit-testing
 *   against the drawn paths themselves (legacy's Voronoi) would be
 *   finer-grained, but snapping to periods is what every point here
 *   already does, so the pick matches what the tooltip then reads out.
 *   Keyboard: left/right step through time as usual, up/down move between
 *   the lines at that moment.
 */
export type InteractiveLineHover = "x" | "series";

export type InteractiveLineProps = {
  series: InteractiveLineSeries[];
  /** Total width/height allocated to this component — typically straight
   * from `ResponsiveChart`'s render-prop dimensions. InteractiveLine lays
   * out its own legend/plot/overview chrome within this budget; it doesn't
   * measure anything itself. */
  width: number;
  height: number;
  /** Caller-injected x domain — omit to auto-domain from every series'
   * points (the common case). Also the domain zoom clamps to; the plot
   * never zooms/pans past it. */
  xDomain?: [Date, Date];
  /** Caller-injected y domain — omit to auto-domain (with headroom) from
   * whatever's currently visible, including band bounds. The headroom never
   * extends below zero when everything visible is non-negative
   * (`padDomain`, #584), so durations and counts never show a "−1h" strip.
   * Auto-domaining
   * re-scales the y-axis as you zoom in on the x-axis (each visible slice
   * gets its own well-fit range); pass this explicitly for a fixed scale
   * that shouldn't shift under zoom (e.g. happiness's natural 0-100). */
  yDomain?: [number, number];
  /** Pins the auto domain's low end while its top still fits whatever's
   * visible — for a measure that can't go negative (a duration), where a
   * wandering baseline exaggerates small changes. Ignored when `yDomain`
   * is passed. Bands aren't clipped, so a caller passing this should clamp
   * its `bandLow`s to it, as `TrendExplorer` does. */
  yMin?: number;
  zoom?: InteractiveLineZoom;
  /** Shaded background bands for historical context (an occupation,
   * residence, or age bracket) — legacy InteractiveScroller's
   * regionData/regionLabel. No production chart wires this yet (per #18's
   * scope — it needs historical datasets nobody's assembled), but the
   * capability is here and correct for when one does. */
  regions?: InteractiveLineRegion[];
  /** Horizontal target/threshold lines (#444) — an 8h working day, say.
   * Always kept inside an auto-fit y domain; see `reference-lines.ts` for
   * why, and pass a stable array (it's a `useD3` dependency). */
  referenceLines?: readonly ReferenceLine[];
  yTickFormat?: (value: d3.NumberValue) => string;
  /** Formats a series' y value for the tooltip row — defaults to `String`.
   * Axis ticks use `yTickFormat` instead; the two often differ (an axis
   * tick can be terser than a tooltip's exact value). */
  valueFormat?: (value: number) => string;
  /** Date preset for the tooltip's title (viz/format.ts's formatDate
   * presets) — defaults to "weekday" (a day-level chart's natural title).
   * A month-bucketed series like HappinessTrendChart should pass
   * "monthYear" instead, since every point already sits on the 1st and a
   * weekday there is meaningless. */
  dateFormat?: DateFormatPreset;
  /** Labels for an x-axis whose dates stand in for something that isn't a
   * point in time — TrendExplorer's seasonal folds (#451), which place Mon–Sun,
   * Jan–Dec or day 1–366 on reference dates in one fixed year (see
   * `src/lib/viz/bin.ts`'s cyclical-folding section). `tick` names axis ticks
   * and `title` the tooltip's heading, replacing `dateFormat` (whose presets
   * would print that reference year); `tickValues` pins the ticks to exact
   * stops. Pass a stable (memoized or module-level) object — it's a `useD3`
   * dependency. */
  xLabels?: {
    tick: (date: Date) => string;
    title: (date: Date) => string;
    tickValues?: readonly Date[];
  };
  margin?: Partial<typeof DEFAULT_MARGIN>;
  /** Accessible label for the hover/keyboard interaction surface — always
   * pass something chart-specific ("Weight over time...", not the
   * component's own generic default), since it's the only thing a
   * screen-reader/keyboard user gets before they start exploring points. */
  ariaLabel?: string;
  /** Series ids that start hidden (legend-toggled off) on first render —
   * for a chart carrying more series than read well at once, where the
   * caller wants to open on a sensible subset and let the reader toggle
   * the rest in (the subs trend, #120: nine subs, opening on three). Read
   * once, as the legend toggle state's initial value: the reader owns the
   * toggles from then on, so a later change to this prop doesn't clobber
   * what they've switched on or off. */
  initialHiddenIds?: readonly string[];
  /** Draw the built-in click-to-toggle legend (with 2+ series). Pass false
   * when the caller renders its own key instead — e.g. a chart with dozens
   * of series whose picker already names each one, where a legend row per
   * line would outgrow the plot. Hidden series can't be toggled back on
   * without it, so don't combine this with `initialHiddenIds`. */
  showLegend?: boolean;
  hover?: InteractiveLineHover;
  /** Each visible line's name, in its colour, just right of the plot at
   * the height its line ends (#110, legacy Averager's `endValueLabel`). In
   * addition to the legend, not instead of it: the legend is still the
   * click-to-toggle control. A right gutter is reserved to fit the longest
   * name, so the plot narrows to make room.
   *
   * - "auto" (default): on with two to six visible lines in "x" hover, on a
   *   plot wide enough to give up the gutter. One line is already named by
   *   the chart's title. Past six, the names stack into a column nobody can
   *   match to lines, and "series" hover exists for charts with that many.
   * - `true` / `false`: always / never. */
  lineLabels?: "auto" | boolean;
  /** Each point's value written beside it (#110, legacy Averager's value
   * labels), above a peak and below a trough. A label is dropped, not
   * squeezed in, if it would cross any line, cover a marker, or overlap a
   * label already placed. The last point and the line's extremes are
   * placed first, so those are the ones that survive a crowded stretch.
   * See `src/lib/viz/line-labels.ts`.
   *
   * - "auto" (default): on for one or two visible lines in "x" hover, for
   *   each line whose points sit far enough apart that every neighbouring
   *   pair of labels clears each other (yearly buckets, a recap's twelve
   *   months; not a ten-year monthly trend).
   * - `true`: every visible line, dense or not, still subject to the
   *   collision rules. `false`: never. */
  pointLabels?: "auto" | boolean;
  /** Formats a point label — defaults to `valueFormat`. */
  pointLabelFormat?: (value: number) => string;
  /** Turns on drag-to-select (#110's "simple x-axis zoom, no scroll"):
   * drag across the plot and, on release, this receives the dates of the
   * first and last points inside the selection. Double-clicking calls it
   * with `null`. The chart doesn't zoom itself. The caller narrows its own
   * data range, the same state its range picker drives, so the drag and
   * the picker are one control rather than two competing notions of what's
   * shown (TrendExplorer re-buckets to the new range). A selection holding
   * fewer than two points is ignored: one point isn't a trend.
   *
   * Mouse and pen only. A touch drag scrolls the page as it always has, and
   * keyboard users have the range picker. Ignored when `zoom` is "direct"
   * or "both", whose d3-zoom drag-to-pan owns the same gesture. */
  onSelectRange?: (range: [Date, Date] | null) => void;
};

type ResolvedSeries = InteractiveLineSeries & { color: string };

function resolveSeriesColors(series: InteractiveLineSeries[]): ResolvedSeries[] {
  return series.map((s, i) => ({ ...s, color: s.color ?? categoricalColor(i) }));
}

/** Every distinct point pixel-x across all series, ascending — the shared
 * "step set" the crosshair snaps/steps through. Deduplicated and combined
 * across series (rather than any one series' own positions) so the
 * crosshair still snaps sensibly when series have different point counts
 * or spacing (a sparse monthly series next to a dense daily one, say). */
function domainsRoughlyEqual(a: [Date, Date] | null, b: [Date, Date]): boolean {
  if (!a) return false;
  return Math.abs(a[0].getTime() - b[0].getTime()) < 1000 && Math.abs(a[1].getTime() - b[1].getTime()) < 1000;
}

function allPixelPositions(series: ResolvedSeries[], x: d3.ScaleTime<number, number>): number[] {
  const set = new Set<number>();
  for (const s of series) for (const p of s.points) set.add(x(p.x));
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Crosshair state for InteractiveLine's (possibly multi-series) plot: a
 * single shared pixel X, with each series independently bisecting into its
 * own points to find its nearest value at that X — see the header comment
 * on `allPixelPositions` for why this is pixel-based rather than reusing
 * tooltip.tsx's single-array `useCrosshair` directly. Handler shape matches
 * `useCrosshair`'s (pointer + keyboard parity, Escape/blur clears).
 *
 * In "series" hover mode (see `InteractiveLineHover`) it also tracks the
 * pointer's y and resolves `focusedIndex`: the one series nearest it,
 * among those with a point at the snapped x. Up/down arrows override the
 * pointer's pick until it next moves.
 */
function useLineCrosshair(
  series: ResolvedSeries[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  mode: InteractiveLineHover,
) {
  const [pixelX, setPixelX] = useState<number | null>(null);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [keyFocusId, setKeyFocusId] = useState<string | null>(null);
  const positions = useMemo(() => allPixelPositions(series, x), [series, x]);
  // Per-series pixel positions, computed once per scale rather than on
  // every pointer move — with dozens of series of hundreds of points each,
  // re-mapping every point on every move is the expensive part of hover.
  const seriesPositions = useMemo(() => series.map((s) => s.points.map((p) => x(p.x))), [series, x]);

  const moveTo = useCallback(
    (localX: number) => {
      if (positions.length === 0) return;
      setPixelX(positions[d3.bisectCenter(positions, localX)] ?? null);
    },
    [positions],
  );

  const hoveredBySeries = useMemo<({ point: InteractiveLinePoint; index: number } | null)[]>(() => {
    if (pixelX === null) return series.map(() => null);
    return series.map((s, i) => {
      if (s.points.length === 0) return null;
      const index = d3.bisectCenter(seriesPositions[i], pixelX);
      const point = s.points[index];
      return point ? { point, index } : null;
    });
  }, [series, seriesPositions, pixelX]);

  // Series with a point exactly at the crosshair, highest value first — the
  // order up/down steps through. A series whose nearest point is some other
  // x (it hasn't started yet, or has a gap) isn't a line under the pointer.
  const candidates = useMemo(() => {
    if (mode !== "series" || pixelX === null) return [];
    return hoveredBySeries
      .map((h, i) => (h && Math.abs(seriesPositions[i][h.index] - pixelX) < 0.5 ? { i, value: h.point.y } : null))
      .filter((c): c is { i: number; value: number } => c !== null)
      .sort((a, b) => b.value - a.value);
  }, [mode, pixelX, hoveredBySeries, seriesPositions]);

  const focusedIndex = useMemo<number | null>(() => {
    if (candidates.length === 0) return null;
    const keyed = keyFocusId === null ? undefined : candidates.find((c) => series[c.i].id === keyFocusId);
    if (keyed) return keyed.i;
    if (pointerY === null) return candidates[0].i;
    let best = candidates[0];
    for (const c of candidates) {
      if (Math.abs(y(c.value) - pointerY) < Math.abs(y(best.value) - pointerY)) best = c;
    }
    return best.i;
  }, [candidates, keyFocusId, pointerY, series, y]);

  const clear = () => {
    setPixelX(null);
    setPointerY(null);
    setKeyFocusId(null);
  };

  const handlers = {
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      moveTo(event.nativeEvent.offsetX);
      if (mode === "series") {
        setPointerY(event.nativeEvent.offsetY);
        setKeyFocusId(null);
      }
    },
    onPointerLeave: clear,
    onFocus: () => setPixelX((cur) => cur ?? (positions.length ? positions[positions.length - 1] : null)),
    onBlur: clear,
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
      } else if (mode === "series" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (candidates.length === 0) return;
        event.preventDefault();
        const at = candidates.findIndex((c) => c.i === focusedIndex);
        // Up means a higher line, which is earlier in the value-descending list.
        const next = event.key === "ArrowUp" ? Math.max(0, at - 1) : Math.min(candidates.length - 1, at + 1);
        setKeyFocusId(series[candidates[next].i].id);
      } else if (event.key === "Escape") {
        clear();
      }
    },
    tabIndex: 0,
  };

  return { pixelX, hoveredBySeries, focusedIndex, handlers };
}

/** The mini navigation strip for "brush"/"both" zoom modes — every series
 * drawn as a thin muted line (a navigation aid isn't the place to spend the
 * categorical palette; only the main plot needs per-series identity),
 * dragged to set the visible domain. `selection` is accepted (not just
 * emitted via `onBrush`) so "both" mode can keep this strip's own handles
 * in sync when the domain instead changes via direct zoom/pan on the main
 * plot — see WeightScrollerChart's pre-#18 Overview for the single-series
 * ancestor of this component. */
function Overview({
  series,
  width,
  fullDomain,
  selection,
  onBrush,
}: {
  series: ResolvedSeries[];
  width: number;
  fullDomain: [Date, Date];
  selection: [Date, Date] | null;
  onBrush: (domain: [Date, Date] | null) => void;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - DEFAULT_MARGIN.left - DEFAULT_MARGIN.right;
      const innerHeight = OVERVIEW_HEIGHT - 8;

      const x = d3.scaleTime().domain(fullDomain).range([0, innerWidth]);
      const allPoints = series.flatMap((s) => s.points);
      const yExtent = d3.extent(allPoints, (p) => p.y) as [number, number];
      const y = d3
        .scaleLinear()
        .domain(yExtent[0] === undefined ? [0, 1] : yExtent)
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", OVERVIEW_HEIGHT)
        .append("g")
        .attr("transform", `translate(${DEFAULT_MARGIN.left},4)`);

      const line = d3
        .line<InteractiveLinePoint>()
        .x((d) => x(d.x))
        .y((d) => y(d.y))
        .curve(d3.curveMonotoneX);

      for (const s of series) {
        g.append("path")
          .datum(s.points)
          .attr("fill", "none")
          .attr("stroke", "var(--muted-foreground)")
          .attr("stroke-width", 1.5)
          .attr("d", line);
      }

      const brush = d3
        .brushX()
        .extent([
          [0, 0],
          [innerWidth, innerHeight],
        ])
        .on("brush end", (event: d3.D3BrushEvent<unknown>) => {
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
      brushG
        .selectAll(".selection")
        .attr("fill", "var(--chart-1)")
        .attr("fill-opacity", 0.15)
        .attr("stroke", "var(--chart-1)");
    },
    // `onBrush` deliberately excluded — see WeightScrollerChart's identical
    // pre-#18 comment: including it would rebuild the brush (and drop the
    // drag gesture) on every state update the brush itself causes.
    [series, width, fullDomain[0].getTime(), fullDomain[1].getTime(), selection?.[0]?.getTime(), selection?.[1]?.getTime()],
  );

  return <svg ref={ref} />;
}

export function InteractiveLine({
  series,
  width,
  height,
  xDomain,
  yDomain,
  yMin,
  zoom = "none",
  regions = [],
  referenceLines = NO_REFERENCE_LINES,
  yTickFormat,
  valueFormat = String,
  dateFormat = "weekday",
  xLabels,
  margin,
  ariaLabel,
  initialHiddenIds,
  showLegend = true,
  hover = "x",
  lineLabels = "auto",
  pointLabels = "auto",
  pointLabelFormat,
  onSelectRange,
}: InteractiveLineProps) {
  const resolvedSeries = useMemo(() => resolveSeriesColors(series), [series]);

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set(initialHiddenIds));
  const visibleSeries = useMemo(
    () => resolvedSeries.filter((s) => !hiddenIds.has(s.id)),
    [resolvedSeries, hiddenIds],
  );

  const showLineLabels =
    lineLabels === "auto"
      ? hover === "x" &&
        visibleSeries.length >= 2 &&
        visibleSeries.length <= MAX_AUTO_LINE_LABELS &&
        width >= MIN_LINE_LABEL_WIDTH
      : lineLabels && visibleSeries.length > 0;
  const showPointLabels =
    pointLabels === "auto"
      ? hover === "x" && visibleSeries.length <= MAX_AUTO_POINT_LABEL_SERIES
      : pointLabels;

  // The line labels' gutter: the longest visible name, capped. Names are
  // fitted to the capped width once here, so the drawing below and the
  // margin agree on what fits.
  const lineLabelTexts = useMemo(() => {
    if (!showLineLabels) return null;
    const maxWidth = Math.max(0, width * MAX_GUTTER_SHARE - GUTTER_PAD);
    return new Map(visibleSeries.map((s) => [s.id, fitLabel(s.label, maxWidth, 600)]));
  }, [showLineLabels, visibleSeries, width]);
  const gutter = lineLabelTexts
    ? GUTTER_PAD + Math.max(0, ...Array.from(lineLabelTexts.values(), (t) => measureLabel(t, 600))) + 4
    : 0;
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };
  MARGIN.right = Math.max(MARGIN.right, gutter);

  const fullXDomain = useMemo<[Date, Date]>(() => {
    if (xDomain) return xDomain;
    const allX = visibleSeries.flatMap((s) => s.points.map((p) => p.x));
    const extent = d3.extent(allX);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : [new Date(), new Date()];
  }, [xDomain, visibleSeries]);

  // Visible domain is uncontrolled internal state — null means "the full
  // domain," rather than duplicating fullXDomain into state up front, so a
  // change to fullXDomain (new data loaded) doesn't require reconciling
  // against a stale zoomed-in state.
  const [visibleDomain, setVisibleDomain] = useState<[Date, Date] | null>(null);
  const effectiveDomain = visibleDomain ?? fullXDomain;

  const hasLegend = showLegend && resolvedSeries.length >= 2;
  const hasOverview = zoom === "brush" || zoom === "both";
  const hasDirectZoom = zoom === "direct" || zoom === "both";

  const [legendRef, legendHeight] = useLegendHeight(LEGEND_HEIGHT);
  const legendReserve = hasLegend ? legendHeight : 0;
  const overviewReserve = hasOverview ? OVERVIEW_HEIGHT : 0;
  const mainHeight = Math.max(MIN_MAIN_HEIGHT, height - legendReserve - overviewReserve);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = mainHeight - MARGIN.top - MARGIN.bottom;

  const x = useMemo(
    () => d3.scaleTime().domain(effectiveDomain).range([0, innerWidth]),
    [effectiveDomain, innerWidth],
  );

  const resolvedYDomain = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    // Band bounds only count toward the domain while a band is actually
    // drawn (exactly one visible series — see `band`'s own doc comment).
    // Counting them regardless left several-lines-at-once views padded out
    // to fit spreads nobody could see, squashing the lines themselves.
    const bandsDrawn = visibleSeries.length === 1;
    const values = visibleSeries.flatMap((s) =>
      s.points
        .filter((p) => p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1])
        .flatMap((p) => {
          const vs = [p.y];
          if (bandsDrawn && s.band) {
            if (p.bandLow !== undefined) vs.push(p.bandLow);
            if (p.bandHigh !== undefined) vs.push(p.bandHigh);
          }
          return vs;
        }),
    );
    values.push(...referenceLineValues(referenceLines));
    if (yMin !== undefined) {
      const hi = d3.max(values) ?? 1;
      const top = Math.max(hi, yMin);
      return [yMin, top + ((top - yMin) * 0.1 || 1)];
    }
    // Floored at zero for non-negative data (#584) — see padDomain.
    return padDomain(values);
  }, [yDomain, yMin, visibleSeries, effectiveDomain, referenceLines]);

  const y = useMemo(
    () => d3.scaleLinear().domain(resolvedYDomain).range([innerHeight, 0]),
    [resolvedYDomain, innerHeight],
  );

  const crosshair = useLineCrosshair(visibleSeries, x, y, hover);

  // Drag-to-select (see `onSelectRange`). The live drag is plain React
  // state: it only moves the selection <div> on the HTML overlay, never
  // anything `useD3` depends on, so a drag doesn't rebuild the SVG.
  const selectable = onSelectRange !== undefined && !hasDirectZoom;
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // clientX against the overlay's own box rather than offsetX: once the
  // pointer is captured it can leave the overlay, and offsetX is then
  // measured from whatever's under it.
  const localX = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(innerWidth, Math.max(0, event.clientX - rect.left));
  };
  const finishDrag = (from: number, to: number) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (!onSelectRange || hi - lo < MIN_SELECT_PX) return;
    const dates = visibleSeries
      .flatMap((s) => s.points.map((p) => p.x))
      .filter((d) => {
        const px = x(d);
        return px >= lo && px <= hi;
      })
      .sort((a, b) => a.getTime() - b.getTime());
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first && last && last.getTime() > first.getTime()) onSelectRange([first, last]);
  };
  const overlayHandlers = selectable
    ? {
        ...crosshair.handlers,
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
          if (event.button !== 0 || event.pointerType === "touch") return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          const at = localX(event);
          setDrag({ from: at, to: at });
        },
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
          if (drag) {
            const to = localX(event);
            setDrag((cur) => (cur ? { ...cur, to } : cur));
          } else {
            crosshair.handlers.onPointerMove(event);
          }
        },
        onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
          if (!drag) return;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          setDrag(null);
          finishDrag(drag.from, localX(event));
        },
        onPointerCancel: () => setDrag(null),
        onDoubleClick: () => onSelectRange?.(null),
      }
    : crosshair.handlers;
  const dragging = drag !== null && Math.abs(drag.to - drag.from) >= MIN_SELECT_PX;

  const overlayRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<{
    behavior: d3.ZoomBehavior<HTMLDivElement, unknown>;
    selection: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  } | null>(null);

  // Direct zoom/pan lives in its own effect, entirely separate from the
  // useD3-managed <svg> below — it's attached to the same plain HTML
  // overlay div the crosshair handlers use (d3.zoom works on any DOM
  // element, not just SVG), so it coexists with React's pointer handlers
  // there without fighting over which layer receives events.
  //
  // d3.zoom stores its live transform on the DOM node itself
  // (`node.__zoom`), not on the behavior object, so it survives this
  // effect re-running — the standard, idiomatic pattern is therefore to
  // rescale from a FIXED base scale (the full, unzoomed domain) rather
  // than from the current domain: `event.transform` is always the total
  // accumulated transform since the gesture began, so rescaling the
  // *current* (already-zoomed) domain on every tick would double-count
  // it. `fullXDomain` (unlike `x`) doesn't change while zooming, so this
  // effect stays attached for an entire gesture instead of tearing down
  // mid-drag.
  useEffect(() => {
    if (!hasDirectZoom) return;
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
        // Bails out (returns the same array) when the new domain is
        // within a second of the current one — both collapses redundant
        // updates from many zoom ticks in a row, and breaks the feedback
        // loop the transform-sync effect below would otherwise cause
        // (sync sets a transform -> fires "zoom" -> would recompute
        // ~the same domain -> would re-trigger sync -> ...).
        setVisibleDomain((cur) => (domainsRoughlyEqual(cur, [d0, d1]) ? cur : [d0, d1]));
      })
      // d3.zoom's default dblclick behavior zooms in a step; overridden
      // below to reset to the full domain instead, the more useful
      // "double-click to reset" convention.
      .on("dblclick.zoom", null);

    const selection = d3.select(node).call(behavior);
    selection.on("dblclick", () => {
      selection.call(behavior.transform, d3.zoomIdentity);
      setVisibleDomain(null);
    });
    zoomRef.current = { behavior, selection };

    return () => {
      selection.on(".zoom", null).on("dblclick", null);
      zoomRef.current = null;
    };
  }, [hasDirectZoom, innerWidth, innerHeight, fullXDomain]);

  // Keeps d3-zoom's own transform in sync when the domain changes for a
  // reason OTHER than this same zoom behavior — the brush, in "both" mode.
  // Without this, the next direct-zoom gesture would compute its delta
  // against d3's stale internal transform and jump back to wherever
  // direct zoom last left off, discarding the brush's change. The
  // domainsRoughlyEqual bail-out in the "zoom" handler above keeps this
  // from bouncing into a render loop with itself.
  useEffect(() => {
    if (!hasDirectZoom || !zoomRef.current) return;
    const { behavior, selection } = zoomRef.current;
    const baseX = d3.scaleTime().domain(fullXDomain).range([0, innerWidth]);
    const domain = visibleDomain ?? fullXDomain;
    const spanPx = baseX(domain[1]) - baseX(domain[0]);
    if (spanPx <= 0) return;
    const k = innerWidth / spanPx;
    const tx = -baseX(domain[0]) * k;
    selection.call(behavior.transform, d3.zoomIdentity.translate(tx, 0).scale(k));
  }, [visibleDomain, hasDirectZoom, fullXDomain, innerWidth]);

  // Consumers pass inline formatters, so reading this through a ref keeps
  // it out of the rebuild's deps below: a new arrow each render (and hover
  // re-renders on every pointer move) would otherwise redraw the whole SVG
  // each time. Declared before `useD3`, so it's current when that runs.
  const labelFormatRef = useRef(pointLabelFormat ?? valueFormat);
  useEffect(() => {
    labelFormatRef.current = pointLabelFormat ?? valueFormat;
  }, [pointLabelFormat, valueFormat]);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const g = svg
        .attr("width", width)
        .attr("height", mainHeight)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      // Regions first — background context, everything else draws on top.
      for (const region of regions) {
        const rx0 = Math.max(0, x(region.start));
        const rx1 = Math.min(innerWidth, x(region.end));
        if (rx1 <= rx0) continue;
        g.append("rect")
          .attr("x", rx0)
          .attr("y", 0)
          .attr("width", rx1 - rx0)
          .attr("height", innerHeight)
          .attr("fill", region.color ?? "var(--muted-foreground)")
          .attr("fill-opacity", 0.08);
        g.append("text")
          .attr("x", rx0 + 4)
          .attr("y", 12)
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", MARK_SPECS.axis.tickFontSize)
          .text(region.label);
      }

      drawStandardAxes({
        g,
        x,
        y,
        innerWidth,
        innerHeight,
        yTicks: 5,
        yTickFormat,
        ...(xLabels
          ? {
              xTickFormat: (value: d3.NumberValue) => xLabels.tick(value instanceof Date ? value : new Date(+value)),
              xTickValues: xLabels.tickValues,
            }
          : {}),
      });
      drawReferenceLines({ g, y, innerWidth, lines: referenceLines });

      const lineGen = d3
        .line<InteractiveLinePoint>()
        .x((d) => x(d.x))
        .y((d) => y(d.y))
        .curve(d3.curveMonotoneX);
      const areaGen = d3
        .area<InteractiveLinePoint>()
        .x((d) => x(d.x))
        .y0((d) => y(d.bandLow ?? d.y))
        .y1((d) => y(d.bandHigh ?? d.y))
        .curve(d3.curveMonotoneX);

      // Bands behind every series' line (not interleaved per-series) so a
      // later series' band never paints over an earlier series' line. Only
      // drawn while exactly one series is visible — see `band`'s own doc
      // comment on `InteractiveLineSeries` for why.
      if (visibleSeries.length === 1) {
        for (const s of visibleSeries) {
          if (!s.band) continue;
          const banded = s.points.filter((p) => p.bandLow !== undefined && p.bandHigh !== undefined);
          if (banded.length === 0) continue;
          g.append("path")
            .datum(banded)
            .attr("fill", s.color)
            .attr("fill-opacity", MARK_SPECS.area.fillOpacity)
            .attr("stroke", "none")
            .attr("d", areaGen);
        }
      }

      for (const s of visibleSeries) {
        g.append("path")
          .datum(s.points)
          .attr("data-series-line", s.id)
          .attr("fill", "none")
          .attr("stroke", s.color)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("d", lineGen);
      }

      for (const s of visibleSeries) {
        if (!s.markers) continue;
        g.selectAll(null)
          .data(s.points)
          .join("circle")
          .attr("cx", (d) => x(d.x))
          .attr("cy", (d) => y(d.y))
          .attr("r", (d, i) => (typeof s.markers === "function" ? s.markers(d, i) : MARK_SPECS.marker.radius))
          .attr("data-series-marker", s.id)
          .attr("fill", s.color)
          .attr("stroke", "var(--card)")
          .attr("stroke-width", MARK_SPECS.marker.ringWidth);
      }

      // Only what's inside the visible x domain gets a label: under brush
      // or direct zoom, points outside it are drawn off the plot.
      const [d0, d1] = x.domain();
      const inDomain = (p: InteractiveLinePoint) => p.x >= d0 && p.x <= d1;
      const radiusOf = (s: ResolvedSeries, p: InteractiveLinePoint, i: number) =>
        !s.markers ? 0 : typeof s.markers === "function" ? s.markers(p, i) : MARK_SPECS.marker.radius;

      if (showPointLabels) {
        const format = labelFormatRef.current;
        const lines = visibleSeries.map((s) => s.points.filter(inDomain).map((p) => ({ x: x(p.x), y: y(p.y) })));
        const markerBoxes = visibleSeries.flatMap((s) =>
          s.points.flatMap((p, i) => {
            const r = radiusOf(s, p, i);
            if (r <= 0 || !inDomain(p)) return [];
            const cx = x(p.x);
            const cy = y(p.y);
            return [{ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }];
          }),
        );
        const texts = new Map<string, string>();
        const candidates: PointLabelCandidate[] = [];
        visibleSeries.forEach((s, si) => {
          const shown = s.points.map((p, i) => ({ p, i })).filter(({ p }) => inDomain(p));
          if (shown.length === 0) return;
          const labels = shown.map(({ p }) => format(p.y));
          const xs = shown.map(({ p }) => x(p.x));
          if (pointLabels === "auto" && !pointsSparseEnough(xs, labels.map((t) => t.length * MIN_CHAR_WIDTH))) return;
          const widths = labels.map((t) => measureLabel(t));
          if (pointLabels === "auto" && !pointsSparseEnough(xs, widths)) return;
          const ys = shown.map(({ p }) => y(p.y));
          const priorities = pointPriorities(shown.map(({ p }) => p.y));
          shown.forEach(({ p, i }, k) => {
            const key = `${si}:${i}`;
            texts.set(key, labels[k]);
            candidates.push({
              key,
              seriesIndex: si,
              x: xs[k],
              y: ys[k],
              radius: radiusOf(s, p, i),
              width: widths[k],
              height: LABEL_HEIGHT,
              // Earlier series outrank later ones outright; within a
              // series, `pointPriorities` decides.
              priority: (visibleSeries.length - si) * 1e6 + priorities[k],
              prefer: preferredSide(ys, k),
            });
          });
        });
        const placed = placePointLabels(candidates, {
          bounds: { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight },
          lines,
          markers: markerBoxes,
        });
        for (const label of placed) {
          const si = Number(label.key.split(":")[0]);
          const s = visibleSeries[si];
          g.append("text")
            .attr("data-series-label", s.id)
            .attr("x", label.x)
            .attr("y", label.y)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("fill", s.color)
            // A surface-coloured halo, so a label stays legible where it
            // sits over a band or a gridline.
            .attr("stroke", "var(--card)")
            .attr("stroke-width", 3)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("font-size", `${LABEL_FONT_SIZE}px`)
            .style("font-variant-numeric", "tabular-nums")
            .text(texts.get(label.key) ?? "");
        }
      }

      if (lineLabelTexts) {
        const ends = visibleSeries.flatMap((s) => {
          const shown = s.points.filter(inDomain);
          const last = shown[shown.length - 1];
          return last ? [{ s, y: y(last.y) }] : [];
        });
        const placedYs = spreadEndLabels(
          ends.map((e) => e.y),
          { height: LABEL_HEIGHT, min: -MARGIN.top, max: innerHeight + MARGIN.bottom / 2 },
        );
        ends.forEach(({ s }, k) => {
          g.append("text")
            .attr("data-series-label", s.id)
            .attr("x", innerWidth + GUTTER_PAD)
            .attr("y", placedYs[k])
            .attr("dominant-baseline", "central")
            .attr("fill", s.color)
            .style("font-size", `${LABEL_FONT_SIZE}px`)
            .style("font-weight", 600)
            .text(lineLabelTexts.get(s.id) ?? s.label);
        });
      }
    },
    [
      visibleSeries,
      regions,
      referenceLines,
      width,
      mainHeight,
      x,
      y,
      yTickFormat,
      xLabels,
      innerWidth,
      innerHeight,
      showPointLabels,
      pointLabels,
      lineLabelTexts,
    ],
  );

  // "series" hover's emphasis, applied to the already-drawn marks rather
  // than by rebuilding the SVG: the focus changes on every pointer move,
  // and useD3's rebuild is only cheap on a real data/size change (see
  // src/hooks/use-d3.ts). Declared after the useD3 call, so on a render
  // that does rebuild, this runs against the fresh marks. The deps mirror
  // that rebuild's own for the same reason.
  const focusedId = crosshair.focusedIndex === null ? null : (visibleSeries[crosshair.focusedIndex]?.id ?? null);
  useEffect(() => {
    const node = ref.current;
    if (!node || hover !== "series") return;
    const svg = d3.select(node);
    svg
      .selectAll<SVGPathElement, unknown>("[data-series-line]")
      .attr("stroke-opacity", function () {
        return focusedId === null || this.getAttribute("data-series-line") === focusedId ? 1 : 0.15;
      })
      .attr("stroke-width", function () {
        return this.getAttribute("data-series-line") === focusedId
          ? MARK_SPECS.line.strokeWidth + 1
          : MARK_SPECS.line.strokeWidth;
      });
    svg.selectAll<SVGElement, unknown>("[data-series-marker], [data-series-label]").attr("opacity", function () {
      const id = this.getAttribute("data-series-marker") ?? this.getAttribute("data-series-label");
      return focusedId === null || id === focusedId ? 1 : 0.15;
    });
    if (focusedId !== null) {
      svg.select(`[data-series-line="${CSS.escape(focusedId)}"]`).raise();
    }
  }, [
    ref,
    hover,
    focusedId,
    visibleSeries,
    regions,
    width,
    mainHeight,
    x,
    y,
    yTickFormat,
    innerWidth,
    innerHeight,
    showPointLabels,
    lineLabelTexts,
  ]);

  // One combined pass over every series' hovered point (skipping series
  // with no point near the current crosshair position) — the tooltip's
  // rows, its vertical anchor, and its title date all derive from this
  // same set rather than re-deriving "what's hovered" three separate ways.
  // In "series" mode that set is just the focused line.
  const hoveredEntries = visibleSeries
    .map((s, i) => {
      if (hover === "series" && i !== crosshair.focusedIndex) return null;
      const h = crosshair.hoveredBySeries[i];
      return h ? { series: s, point: h.point, index: h.index } : null;
    })
    .filter((e): e is { series: ResolvedSeries; point: InteractiveLinePoint; index: number } => e !== null);

  const tooltipRows: TooltipRow[] = hoveredEntries.map(({ series: s, point, index }) => ({
    label: s.tooltipLabel ? s.tooltipLabel(point, index) : s.label,
    value: valueFormat(point.y),
    color: s.color,
  }));

  // Anchored to the average of every hovered series' own y-position rather
  // than any single series' value, since multiple series can be hovered at
  // once with different y's; falls back to vertical center when nothing's
  // hovered (harmless — the tooltip itself is hidden in that case anyway).
  const tooltipY = hoveredEntries.length
    ? hoveredEntries.reduce((sum, e) => sum + y(e.point.y), 0) / hoveredEntries.length
    : innerHeight / 2;

  // The hovered point's own x, not `x.invert(pixelX)` re-derived from the
  // pixel position — pixelX is already snapped exactly to a point's own
  // pixel-x (see allPixelPositions), so this is equivalent in principle,
  // but reading the point's real Date directly sidesteps ever depending on
  // a linear-scale invert() round-trip being bit-exact.
  const tooltipTitleDate = hoveredEntries[0]?.point.x;

  return (
    <div style={{ position: "relative", width, height }}>
      {hasLegend ? (
        <div ref={legendRef} className="pb-1.5">
          <Legend
            series={resolvedSeries.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
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
        </div>
      ) : null}
      <div style={{ position: "relative", width, height: mainHeight }}>
        <svg ref={ref} />
        <div
          ref={overlayRef}
          className="absolute"
          style={{
            left: MARGIN.left,
            top: MARGIN.top,
            width: innerWidth,
            height: innerHeight,
            cursor: hasDirectZoom ? "grab" : selectable ? "crosshair" : undefined,
          }}
          role="img"
          aria-label={ariaLabel ?? "Interactive chart. Use arrow keys to inspect data points, or hover to see values."}
          {...overlayHandlers}
        >
          {dragging ? (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 border-x border-primary/50 bg-primary/10"
              style={{ left: Math.min(drag.from, drag.to), width: Math.abs(drag.to - drag.from) }}
            />
          ) : null}
          {crosshair.pixelX !== null && !dragging ? (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
              style={{ left: crosshair.pixelX }}
            />
          ) : null}
          {hover === "series" && crosshair.pixelX !== null && !dragging && hoveredEntries[0] ? (
            // The picked point itself, so the tooltip's value visibly
            // belongs to one spot on one line.
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full"
              style={{
                left: crosshair.pixelX - MARK_SPECS.marker.radius,
                top: y(hoveredEntries[0].point.y) - MARK_SPECS.marker.radius,
                width: MARK_SPECS.marker.radius * 2,
                height: MARK_SPECS.marker.radius * 2,
                backgroundColor: hoveredEntries[0].series.color,
                boxShadow: `0 0 0 ${MARK_SPECS.marker.ringWidth}px var(--card)`,
              }}
            />
          ) : null}
        </div>
        {tooltipRows.length > 0 && crosshair.pixelX !== null && !dragging && tooltipTitleDate ? (
          <ChartTooltip
            x={MARGIN.left + crosshair.pixelX}
            y={MARGIN.top + tooltipY}
            title={xLabels ? xLabels.title(tooltipTitleDate) : formatDate(toDateString(tooltipTitleDate), dateFormat)}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
      {hasOverview ? (
        <Overview
          series={visibleSeries}
          width={width}
          fullDomain={fullXDomain}
          selection={visibleDomain}
          onBrush={setVisibleDomain}
        />
      ) : null}
    </div>
  );
}
