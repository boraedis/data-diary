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
import { Legend } from "./legend";

// InteractiveLine (#18) — the shared time-series primitive that replaces
// three overlapping legacy constructors (Scroller, Averager, TimeLine) and
// generalizes this repo's two one-off implementations
// (WeightScrollerChart, HappinessAveragerChart — now thin wrappers around
// this) into one composable component. See issue #18 for the full spec;
// this file's own doc comments cover the *why* behind each design choice
// below.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
// Overview strip and legend both reserve a small fixed slice of the total
// height budget (passed in from ResponsiveChart) before the main plot gets
// whatever's left — the same "subtract fixed chrome, floor the remainder"
// approach WeightScrollerChart used pre-#18 for its overview strip alone.
const OVERVIEW_HEIGHT = 64;
const LEGEND_HEIGHT = 28;
const MIN_MAIN_HEIGHT = 160;

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
   * individually instead — e.g. HappinessAveragerChart's "bigger dot = more
   * days fed this average" — and is NOT clamped to the spec's minimum,
   * since the whole point of a variable radius is to also go smaller for
   * lower-confidence points; the spec minimum is only the *default*, not a
   * floor on every mode. */
  markers?: boolean | ((point: InteractiveLinePoint, index: number) => number);
  /** Render `bandLow`/`bandHigh` as a translucent area behind this series'
   * line (legacy Averager's min/max band). */
  band?: boolean;
  /** Per-point tooltip row label, overriding this series' own `label` for
   * that one row — e.g. HappinessAveragerChart's "12 days" sample-size
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
   * whatever's currently visible, including band bounds. Auto-domaining
   * re-scales the y-axis as you zoom in on the x-axis (each visible slice
   * gets its own well-fit range); pass this explicitly for a fixed scale
   * that shouldn't shift under zoom (e.g. happiness's natural 0-100). */
  yDomain?: [number, number];
  zoom?: InteractiveLineZoom;
  /** Shaded background bands for historical context (an occupation,
   * residence, or age bracket) — legacy InteractiveScroller's
   * regionData/regionLabel. No production chart wires this yet (per #18's
   * scope — it needs historical datasets nobody's assembled), but the
   * capability is here and correct for when one does. */
  regions?: InteractiveLineRegion[];
  yTickFormat?: (value: d3.NumberValue) => string;
  /** Formats a series' y value for the tooltip row — defaults to `String`.
   * Axis ticks use `yTickFormat` instead; the two often differ (an axis
   * tick can be terser than a tooltip's exact value). */
  valueFormat?: (value: number) => string;
  /** Date preset for the tooltip's title (viz/format.ts's formatDate
   * presets) — defaults to "weekday" (a day-level chart's natural title).
   * A month-bucketed series like HappinessAveragerChart should pass
   * "monthYear" instead, since every point already sits on the 1st and a
   * weekday there is meaningless. */
  dateFormat?: DateFormatPreset;
  margin?: Partial<typeof DEFAULT_MARGIN>;
  /** Accessible label for the hover/keyboard interaction surface — always
   * pass something chart-specific ("Weight over time...", not the
   * component's own generic default), since it's the only thing a
   * screen-reader/keyboard user gets before they start exploring points. */
  ariaLabel?: string;
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
 */
function useLineCrosshair(series: ResolvedSeries[], x: d3.ScaleTime<number, number>) {
  const [pixelX, setPixelX] = useState<number | null>(null);
  const positions = useMemo(() => allPixelPositions(series, x), [series, x]);

  const moveTo = useCallback(
    (localX: number) => {
      if (positions.length === 0) return;
      setPixelX(positions[d3.bisectCenter(positions, localX)] ?? null);
    },
    [positions],
  );

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

  const hoveredBySeries = useMemo<({ point: InteractiveLinePoint; index: number } | null)[]>(() => {
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
  zoom = "none",
  regions = [],
  yTickFormat,
  valueFormat = String,
  dateFormat = "weekday",
  margin,
  ariaLabel,
}: InteractiveLineProps) {
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };

  const resolvedSeries = useMemo(() => resolveSeriesColors(series), [series]);

  const fullXDomain = useMemo<[Date, Date]>(() => {
    if (xDomain) return xDomain;
    const allX = resolvedSeries.flatMap((s) => s.points.map((p) => p.x));
    const extent = d3.extent(allX);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : [new Date(), new Date()];
  }, [xDomain, resolvedSeries]);

  // Visible domain is uncontrolled internal state — null means "the full
  // domain," rather than duplicating fullXDomain into state up front, so a
  // change to fullXDomain (new data loaded) doesn't require reconciling
  // against a stale zoomed-in state.
  const [visibleDomain, setVisibleDomain] = useState<[Date, Date] | null>(null);
  const effectiveDomain = visibleDomain ?? fullXDomain;

  const hasLegend = resolvedSeries.length >= 2;
  const hasOverview = zoom === "brush" || zoom === "both";
  const hasDirectZoom = zoom === "direct" || zoom === "both";

  const legendReserve = hasLegend ? LEGEND_HEIGHT : 0;
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
    const visible = resolvedSeries.flatMap((s) =>
      s.points.filter((p) => p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1]),
    );
    const values = visible.flatMap((p) => {
      const vs = [p.y];
      if (p.bandLow !== undefined) vs.push(p.bandLow);
      if (p.bandHigh !== undefined) vs.push(p.bandHigh);
      return vs;
    });
    const [lo, hi] = (d3.extent(values.length ? values : [0, 1]) as [number, number]);
    const pad = (hi - lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }, [yDomain, resolvedSeries, effectiveDomain]);

  const y = useMemo(
    () => d3.scaleLinear().domain(resolvedYDomain).range([innerHeight, 0]),
    [resolvedYDomain, innerHeight],
  );

  const crosshair = useLineCrosshair(resolvedSeries, x);

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

      drawStandardAxes({ g, x, y, innerWidth, innerHeight, yTicks: 5, yTickFormat });

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
      // later series' band never paints over an earlier series' line.
      for (const s of resolvedSeries) {
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

      for (const s of resolvedSeries) {
        g.append("path")
          .datum(s.points)
          .attr("fill", "none")
          .attr("stroke", s.color)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("d", lineGen);
      }

      for (const s of resolvedSeries) {
        if (!s.markers) continue;
        g.selectAll(null)
          .data(s.points)
          .join("circle")
          .attr("cx", (d) => x(d.x))
          .attr("cy", (d) => y(d.y))
          .attr("r", (d, i) => (typeof s.markers === "function" ? s.markers(d, i) : MARK_SPECS.marker.radius))
          .attr("fill", s.color)
          .attr("stroke", "var(--card)")
          .attr("stroke-width", MARK_SPECS.marker.ringWidth);
      }
    },
    [resolvedSeries, regions, width, mainHeight, x, y, yTickFormat, innerWidth, innerHeight],
  );

  // One combined pass over every series' hovered point (skipping series
  // with no point near the current crosshair position) — the tooltip's
  // rows, its vertical anchor, and its title date all derive from this
  // same set rather than re-deriving "what's hovered" three separate ways.
  const hoveredEntries = resolvedSeries
    .map((s, i) => {
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
        <Legend
          series={resolvedSeries.map((s) => ({ label: s.label, color: s.color }))}
          className="mb-1.5"
        />
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
            cursor: hasDirectZoom ? "grab" : undefined,
          }}
          role="img"
          aria-label={ariaLabel ?? "Interactive chart. Use arrow keys to inspect data points, or hover to see values."}
          {...crosshair.handlers}
        >
          {crosshair.pixelX !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
              style={{ left: crosshair.pixelX }}
            />
          ) : null}
        </div>
        {tooltipRows.length > 0 && crosshair.pixelX !== null && tooltipTitleDate ? (
          <ChartTooltip
            x={MARGIN.left + crosshair.pixelX}
            y={MARGIN.top + tooltipY}
            title={formatDate(toDateString(tooltipTitleDate), dateFormat)}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
      {hasOverview ? (
        <Overview
          series={resolvedSeries}
          width={width}
          fullDomain={fullXDomain}
          selection={visibleDomain}
          onBrush={setVisibleDomain}
        />
      ) : null}
    </div>
  );
}
