"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { toDateString } from "@/lib/date";
import { formatDate, formatPercent, type DateFormatPreset } from "@/lib/viz/format";
import { categoricalColor } from "@/lib/viz/color";
import { drawStandardAxes } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow, useCrosshair } from "./tooltip";
import { Legend } from "./legend";

// InteractiveArea (#19) — the shared stacked/proportional area primitive,
// replacing legacy's Area/AreaAverager constructors (18 legacy call sites:
// exercise-by-category, entertainment-by-kind, spending-by-category, etc.
// — see the issue for the full list). No app chart in this repo used this
// shape before #19; ExerciseAreaChart (this same PR) is the first real
// consumer, picked because workouts/exercise-category data is already
// fully migrated (Phases 1-3) and already backs the gym page.
//
// Data shape is deliberately transposed from InteractiveLine's "N series,
// each with its own points": here every point already carries every
// category's value at one shared x (`values: Record<categoryId, number>`),
// because a stack fundamentally needs one common x per bucket to stack
// against — there's no such thing as "series A's own x positions" the way
// InteractiveLine has to support (independently-sampled series with
// possibly different point counts/spacing). That's also why this reuses
// tooltip.tsx's plain `useCrosshair(data, xPositions)` directly instead of
// InteractiveLine's own `useLineCrosshair` (built specifically to bisect
// each series independently) — one shared x array is exactly what
// `useCrosshair` already assumes.
//
// Stacked vs. proportional is one flag, not two components: both modes
// share the same `d3.stack()` call, differing only in `.offset()`
// (`stackOffsetNone` vs. `stackOffsetExpand`, d3's own built-in 100%-
// normalization — no hand-rolled percentage math needed). `stackOrderNone`
// keeps categories in the caller's given order (bottom to top) rather than
// reordering by value (`stackOrderInsideOut` etc.) — color follows the
// entity, and so does stacking order, per the dataviz skill's fixed-order
// rule.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const LEGEND_HEIGHT = 28;
const MIN_MAIN_HEIGHT = 160;
// The full MARK_SPECS.bar.surfaceGap (2px), applied entirely to one edge
// of each internal boundary rather than split 1px+1px across both
// neighbors — see the per-layer render loop below for why one-sided is
// simpler here (and avoids a second clamp for the layer above).
const GAP_INSET = MARK_SPECS.bar.surfaceGap;

export type InteractiveAreaCategory = {
  id: string;
  label: string;
  /** Defaults to `categoricalColor(i)` using this category's index in the
   * *original* `categories` array (fixed slot order) — pass this only to
   * pin a specific slot regardless of array order. Resolved once up front
   * from the full list, before any hiding/filtering, so a toggled-off
   * category never causes the survivors to shift color (see Legend's own
   * doc comment on the same rule). */
  color?: string;
};

export type InteractiveAreaPoint = {
  x: Date;
  /** This point's value per category id. A category missing from the map
   * is treated as 0 (not "no data") — every category is assumed to apply
   * at every x, the same "0 workouts that month" shape a stacked count
   * chart actually has. Values are assumed non-negative (a stack's
   * baseline is always 0) — this primitive doesn't support negative
   * values, which #19's scope never called for. */
  values: Record<string, number>;
};

export type InteractiveAreaMode = "stacked" | "proportional";

export type InteractiveAreaProps = {
  categories: InteractiveAreaCategory[];
  /** Oldest first, one shared x per point — same convention as every
   * other chart's data-fetcher in this app (e.g. groupByPeriod's output).
   * Not re-sorted here. */
  points: InteractiveAreaPoint[];
  width: number;
  height: number;
  mode?: InteractiveAreaMode;
  xDomain?: [Date, Date];
  /** Formats a category's raw value for the tooltip row — same raw
   * number in both modes (the tooltip states the real value regardless of
   * whether the chart is currently drawing it as an absolute band or a
   * normalized slice; only the *visual* is different between modes, the
   * underlying data isn't). Defaults to `String`. */
  valueFormat?: (value: number) => string;
  /** Y-axis tick formatter. Defaults to `formatPercent` in "proportional"
   * mode (a bare 0-1 fraction is meaningless on an axis without it) and
   * d3's own default in "stacked" mode. */
  yTickFormat?: (value: d3.NumberValue) => string;
  dateFormat?: DateFormatPreset;
  margin?: Partial<typeof DEFAULT_MARGIN>;
  ariaLabel?: string;
};

type ResolvedCategory = InteractiveAreaCategory & { color: string };
type StackLayer = d3.Series<InteractiveAreaPoint, string>;

function resolveCategoryColors(categories: InteractiveAreaCategory[]): ResolvedCategory[] {
  return categories.map((c, i) => ({ ...c, color: c.color ?? categoricalColor(i) }));
}

export function InteractiveArea({
  categories,
  points,
  width,
  height,
  mode = "stacked",
  xDomain,
  valueFormat = String,
  yTickFormat,
  dateFormat = "weekday",
  margin,
  ariaLabel,
}: InteractiveAreaProps) {
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };

  const resolvedCategories = useMemo(() => resolveCategoryColors(categories), [categories]);

  // Click-to-toggle state lives here, not in the caller — the same "it's
  // just part of how this primitive works" ownership InteractiveLine's
  // zoom state has, so every consumer gets it for free rather than having
  // to wire up its own hidden-set plumbing.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCategory = (id: string) =>
    setHiddenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Refuse to hide the last visible category — an empty stack isn't a
      // useful state and d3.stack's own proportional (expand) offset is
      // only well-defined with at least one visible series.
      if (next.size === resolvedCategories.length) return cur;
      return next;
    });
  const visibleCategories = resolvedCategories.filter((c) => !hiddenIds.has(c.id));

  const fullXDomain = useMemo<[Date, Date]>(() => {
    if (xDomain) return xDomain;
    const extent = d3.extent(points, (p) => p.x);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : [new Date(), new Date()];
  }, [xDomain, points]);

  const hasLegend = resolvedCategories.length >= 2;
  const legendReserve = hasLegend ? LEGEND_HEIGHT : 0;
  const mainHeight = Math.max(MIN_MAIN_HEIGHT, height - legendReserve);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = mainHeight - MARGIN.top - MARGIN.bottom;

  const x = useMemo(() => d3.scaleTime().domain(fullXDomain).range([0, innerWidth]), [fullXDomain, innerWidth]);

  const stacked = useMemo<StackLayer[]>(() => {
    const stackGen = d3
      .stack<InteractiveAreaPoint>()
      .keys(visibleCategories.map((c) => c.id))
      .value((d, key) => d.values[key] ?? 0)
      .order(d3.stackOrderNone)
      .offset(mode === "proportional" ? d3.stackOffsetExpand : d3.stackOffsetNone);
    return stackGen(points);
  }, [points, visibleCategories, mode]);

  const yDomain = useMemo<[number, number]>(() => {
    if (mode === "proportional") return [0, 1]; // stackOffsetExpand always sums to 1
    const top = stacked.length ? d3.max(stacked[stacked.length - 1], (d) => d[1]) ?? 0 : 0;
    return [0, top === 0 ? 1 : top * 1.1];
  }, [mode, stacked]);

  const y = useMemo(() => d3.scaleLinear().domain(yDomain).range([innerHeight, 0]), [yDomain, innerHeight]);

  const resolvedYTickFormat = yTickFormat ?? (mode === "proportional" ? (v: d3.NumberValue) => formatPercent(+v) : undefined);

  const xPositions = useMemo(() => points.map((p) => x(p.x)), [points, x]);
  const crosshair = useCrosshair(points, xPositions);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const g = svg
        .attr("width", width)
        .attr("height", mainHeight)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      drawStandardAxes({ g, x, y, innerWidth, innerHeight, yTicks: 5, yTickFormat: resolvedYTickFormat });

      // Per layer: a translucent fill (the wash) plus a solid line tracing
      // its own top edge (the fill alone, at ~10% opacity, doesn't read as
      // a defined band on its own — the line is what a reader's eye
      // actually follows). The fill's *bottom* edge is inset up by
      // GAP_INSET px for every layer except the bottom-most (which sits on
      // the real baseline, not a neighbor) — that's the "surface-color gap
      // between segments" from marks-and-anatomy.md, adapted from bars'
      // literal padding to areas' one-axis stacking: since y0/y1 here are
      // plain numbers (not an arbitrary 2D shape), "inset from the
      // neighbor below" is just "subtract a few px from this layer's own
      // bottom," with the neighbor's own top line still sitting exactly on
      // the true boundary. Only one side of each boundary is inset (not
      // split 1px+1px) — simpler, and avoids a separate clamp for the
      // layer above's already-uninset top.
      visibleCategories.forEach((cat, i) => {
        const layer = stacked[i];
        if (!layer) return;
        const isBottom = i === 0;

        const areaGen = d3
          .area<d3.SeriesPoint<InteractiveAreaPoint>>()
          .x((d) => x(d.data.x))
          .y0((d) => {
            const raw = y(d[0]);
            const inset = isBottom ? raw : raw - GAP_INSET;
            const top = y(d[1]);
            return Math.max(inset, top); // never invert on a near-zero band
          })
          .y1((d) => y(d[1]))
          .curve(d3.curveMonotoneX);

        g.append("path")
          .datum(layer)
          .attr("fill", cat.color)
          .attr("fill-opacity", MARK_SPECS.area.fillOpacity)
          .attr("stroke", "none")
          .attr("d", areaGen);

        const lineGen = d3
          .line<d3.SeriesPoint<InteractiveAreaPoint>>()
          .x((d) => x(d.data.x))
          .y((d) => y(d[1]))
          .curve(d3.curveMonotoneX);

        g.append("path")
          .datum(layer)
          .attr("fill", "none")
          .attr("stroke", cat.color)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("d", lineGen);
      });
    },
    [visibleCategories, stacked, width, mainHeight, x, y, innerWidth, innerHeight, resolvedYTickFormat],
  );

  // One tooltip row per *visible* category (fixed order), at the hovered
  // x — "every category's value at that X in one tooltip, not per-band"
  // per #19's own acceptance criteria, rather than a per-mark hover the
  // way InteractiveHist's discrete bars use.
  const tooltipRows: TooltipRow[] = crosshair.point
    ? visibleCategories.map((c) => ({
        label: c.label,
        value: valueFormat(crosshair.point!.values[c.id] ?? 0),
        color: c.color,
      }))
    : [];

  return (
    <div style={{ position: "relative", width, height }}>
      {hasLegend ? (
        <Legend
          series={resolvedCategories.map((c) => ({ id: c.id, label: c.label, color: c.color }))}
          onToggle={toggleCategory}
          hiddenIds={hiddenIds}
          className="mb-1.5"
        />
      ) : null}
      <div style={{ position: "relative", width, height: mainHeight }}>
        <svg ref={ref} />
        <div
          className="absolute"
          style={{ left: MARGIN.left, top: MARGIN.top, width: innerWidth, height: innerHeight }}
          role="img"
          aria-label={ariaLabel ?? "Interactive chart. Use arrow keys to inspect values, or hover to see them."}
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
        {tooltipRows.length > 0 && crosshair.pixelX !== null && crosshair.point ? (
          <ChartTooltip
            x={MARGIN.left + crosshair.pixelX}
            y={MARGIN.top + innerHeight / 2}
            title={formatDate(toDateString(crosshair.point.x), dateFormat)}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
    </div>
  );
}
