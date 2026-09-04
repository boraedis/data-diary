"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { toDateString } from "@/lib/date";
import { formatDate, type DateFormatPreset } from "@/lib/viz/format";
import { categoricalColor } from "@/lib/viz/color";
import { drawStandardAxes } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, useCrosshair, type TooltipRow } from "./tooltip";
import { Legend } from "./legend";
import type { InteractiveLineRegion } from "./interactive-line";

// InteractiveScroller (#117) — a standalone primitive for raw, day-cadence
// series (every logged day gets its own point) with a rolling-average
// overlay, always-on minimap + direct zoom/pan (kept in sync), and region
// bands. Deliberately NOT a preset over InteractiveLine (#18): that
// component already has a `zoom="direct"`/`"both"` mode and a `regions`
// prop covering much of the same ground, but per #117's own scoping note
// this is meant to diverge in its own direction over time rather than stay
// a thin skin over the grouped/aggregated-series primitive — InteractiveLine
// plays legacy's `Averager` role (pre-bucketed series, one point per
// month/week/whatever), this one plays legacy's `InteractiveScroller` role
// (raw daily density). Some mechanics below (the direct-zoom effect pair,
// the minimap strip) are intentionally near-duplicates of InteractiveLine's
// own — see that file's comments for the reasoning behind each, not
// re-explained twice here.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const MINIMAP_HEIGHT = 64;
const LEGEND_HEIGHT = 28;
const MIN_MAIN_HEIGHT = 160;
const DEFAULT_MOVING_AVERAGE_WINDOW = 30; // legacy's movingAverageSize default

export type InteractiveScrollerPoint = { x: Date; y: number };

/** Re-exported under this primitive's own name rather than redefined —
 * per #117's own scoping note, sharing InteractiveLine's region shape (even
 * though the two primitives render regions with separate code) means one
 * region dataset can feed either without reshaping. */
export type InteractiveScrollerRegion = InteractiveLineRegion;

export type InteractiveScrollerProps = {
  points: InteractiveScrollerPoint[];
  width: number;
  height: number;
  /** Raw series label — shown in the legend/tooltip (e.g. "Weight"). */
  label: string;
  color?: string;
  /** Trailing window size, in points (not calendar days — an index-based
   * trailing average over however many points actually exist, since a
   * personal log can have gaps). Defaults to legacy's 30. Pass 0 to omit
   * the average overlay entirely (and the minimap, which always plots the
   * smoothed series — see `Minimap` below). */
  movingAverageWindow?: number;
  movingAverageLabel?: string;
  regions?: InteractiveScrollerRegion[];
  yDomain?: [number, number];
  yTickFormat?: (value: d3.NumberValue) => string;
  valueFormat?: (value: number) => string;
  dateFormat?: DateFormatPreset;
  margin?: Partial<typeof DEFAULT_MARGIN>;
  ariaLabel?: string;
};

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

function domainsRoughlyEqual(a: [Date, Date] | null, b: [Date, Date]): boolean {
  if (!a) return false;
  return Math.abs(a[0].getTime() - b[0].getTime()) < 1000 && Math.abs(a[1].getTime() - b[1].getTime()) < 1000;
}

/** Bottom minimap strip — always plots the smoothed (moving-average)
 * series across the FULL range, per legacy's own spec, regardless of
 * whether the main plot's average overlay is currently toggled off: the
 * minimap's job is an at-a-glance shape of the whole history, and the
 * smoothed line reads better at that scale than a noisy raw one would.
 * Drag to set the visible window; kept in sync with direct zoom/pan on the
 * main plot via `selection`/`onBrush`, same two-way pattern as
 * InteractiveLine's "both" zoom mode. */
function Minimap({
  averagePoints,
  width,
  fullDomain,
  selection,
  onBrush,
  color,
}: {
  averagePoints: InteractiveScrollerPoint[];
  width: number;
  fullDomain: [Date, Date];
  selection: [Date, Date] | null;
  onBrush: (domain: [Date, Date] | null) => void;
  color: string;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - DEFAULT_MARGIN.left - DEFAULT_MARGIN.right;
      const innerHeight = MINIMAP_HEIGHT - 8;

      const x = d3.scaleTime().domain(fullDomain).range([0, innerWidth]);
      const yExtent = d3.extent(averagePoints, (p) => p.y) as [number, number];
      const y = d3
        .scaleLinear()
        .domain(yExtent[0] === undefined ? [0, 1] : yExtent)
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", MINIMAP_HEIGHT)
        .append("g")
        .attr("transform", `translate(${DEFAULT_MARGIN.left},4)`);

      const line = d3
        .line<InteractiveScrollerPoint>()
        .x((d) => x(d.x))
        .y((d) => y(d.y))
        .curve(d3.curveMonotoneX);

      g.append("path").datum(averagePoints).attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("d", line);

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
      brushG.selectAll(".selection").attr("fill", "var(--chart-1)").attr("fill-opacity", 0.15).attr("stroke", "var(--chart-1)");
    },
    // `onBrush` deliberately excluded — see InteractiveLine's Overview for
    // why (would rebuild the brush, and drop an in-progress drag, on every
    // state update the brush itself causes).
    [averagePoints, width, fullDomain[0].getTime(), fullDomain[1].getTime(), selection?.[0]?.getTime(), selection?.[1]?.getTime(), color],
  );

  return <svg ref={ref} />;
}

export function InteractiveScroller({
  points,
  width,
  height,
  label,
  color,
  movingAverageWindow = DEFAULT_MOVING_AVERAGE_WINDOW,
  movingAverageLabel,
  regions = [],
  yDomain,
  yTickFormat,
  valueFormat = String,
  dateFormat = "weekday",
  margin,
  ariaLabel,
}: InteractiveScrollerProps) {
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };
  const rawColor = color ?? categoricalColor(0);
  const avgColor = categoricalColor(1);
  const resolvedAvgLabel = movingAverageLabel ?? `${movingAverageWindow}-point average`;

  const sortedPoints = useMemo(() => [...points].sort((a, b) => a.x.getTime() - b.x.getTime()), [points]);
  const averagePoints = useMemo(
    () => (movingAverageWindow > 0 ? computeMovingAverage(sortedPoints, movingAverageWindow) : []),
    [sortedPoints, movingAverageWindow],
  );

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const showAverage = averagePoints.length > 0 && !hiddenIds.has("average");
  const showRaw = !hiddenIds.has("raw");

  const fullXDomain = useMemo<[Date, Date]>(() => {
    const extent = d3.extent(sortedPoints, (p) => p.x);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : [new Date(), new Date()];
  }, [sortedPoints]);

  const [visibleDomain, setVisibleDomain] = useState<[Date, Date] | null>(null);
  const effectiveDomain = visibleDomain ?? fullXDomain;

  const hasMinimap = averagePoints.length > 0;
  const legendReserve = LEGEND_HEIGHT;
  const minimapReserve = hasMinimap ? MINIMAP_HEIGHT : 0;
  const mainHeight = Math.max(MIN_MAIN_HEIGHT, height - legendReserve - minimapReserve);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = mainHeight - MARGIN.top - MARGIN.bottom;

  const x = useMemo(() => d3.scaleTime().domain(effectiveDomain).range([0, innerWidth]), [effectiveDomain, innerWidth]);

  const visibleRaw = useMemo(
    () => sortedPoints.filter((p) => p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1]),
    [sortedPoints, effectiveDomain],
  );
  const visibleAvg = useMemo(
    () => averagePoints.filter((p) => p.x >= effectiveDomain[0] && p.x <= effectiveDomain[1]),
    [averagePoints, effectiveDomain],
  );

  const resolvedYDomain = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    const values = [
      ...(showRaw ? visibleRaw.map((p) => p.y) : []),
      ...(showAverage ? visibleAvg.map((p) => p.y) : []),
    ];
    const [lo, hi] = d3.extent(values.length ? values : [0, 1]) as [number, number];
    const pad = (hi - lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }, [yDomain, visibleRaw, visibleAvg, showRaw, showAverage]);

  const y = useMemo(() => d3.scaleLinear().domain(resolvedYDomain).range([innerHeight, 0]), [resolvedYDomain, innerHeight]);

  const xPositions = useMemo(() => sortedPoints.map((p) => x(p.x)), [sortedPoints, x]);
  const crosshair = useCrosshair(sortedPoints, xPositions);

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

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const g = svg
        .attr("width", width)
        .attr("height", mainHeight)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

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
        .line<InteractiveScrollerPoint>()
        .x((d) => x(d.x))
        .y((d) => y(d.y))
        .curve(d3.curveMonotoneX);

      if (showRaw) {
        g.append("path")
          .datum(visibleRaw)
          .attr("fill", "none")
          .attr("stroke", rawColor)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("stroke-opacity", showAverage ? 0.5 : 1)
          .attr("d", lineGen);

        if (visibleRaw.length < 150) {
          g.selectAll(null)
            .data(visibleRaw)
            .join("circle")
            .attr("cx", (d) => x(d.x))
            .attr("cy", (d) => y(d.y))
            .attr("r", MARK_SPECS.marker.radius)
            .attr("fill", rawColor)
            .attr("fill-opacity", showAverage ? 0.5 : 1)
            .attr("stroke", "var(--card)")
            .attr("stroke-width", MARK_SPECS.marker.ringWidth);
        }
      }

      if (showAverage) {
        g.append("path")
          .datum(visibleAvg)
          .attr("fill", "none")
          .attr("stroke", avgColor)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("d", lineGen);
      }
    },
    [regions, width, mainHeight, x, y, yTickFormat, innerWidth, innerHeight, visibleRaw, visibleAvg, showRaw, showAverage, rawColor, avgColor],
  );

  const hoveredAvg = crosshair.index !== null ? averagePoints[crosshair.index] : null;
  const tooltipRows: TooltipRow[] = [];
  if (crosshair.point && showRaw) {
    tooltipRows.push({ label, value: valueFormat(crosshair.point.y), color: rawColor });
  }
  if (hoveredAvg && showAverage) {
    tooltipRows.push({ label: resolvedAvgLabel, value: valueFormat(hoveredAvg.y), color: avgColor });
  }

  const legendSeries = [
    { id: "raw", label, color: rawColor },
    ...(hasMinimap ? [{ id: "average", label: resolvedAvgLabel, color: avgColor }] : []),
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
        {tooltipRows.length > 0 && crosshair.pixelX !== null && crosshair.point ? (
          <ChartTooltip
            x={MARGIN.left + crosshair.pixelX}
            y={MARGIN.top + y(crosshair.point.y)}
            title={formatDate(toDateString(crosshair.point.x), dateFormat)}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
      {hasMinimap ? (
        <Minimap
          averagePoints={averagePoints}
          width={width}
          fullDomain={fullXDomain}
          selection={visibleDomain}
          onBrush={setVisibleDomain}
          color={avgColor}
        />
      ) : null}
    </div>
  );
}
