"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { toDateString } from "@/lib/date";
import { formatDate, formatPercent, type DateFormatPreset } from "@/lib/viz/format";
import { categoricalColor, contrastingTextColor } from "@/lib/viz/color";
import { fitBandLabelWithAlias, type LabelFitOptions } from "@/lib/viz/area-labels";
import { drawStandardAxes, drawYGridlines } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";

// InteractiveArea (#19) - the shared stacked/proportional area primitive,
// replacing legacy's Area/AreaAverager constructors (18 legacy call sites:
// exercise-by-category, entertainment-by-kind, spending-by-category, etc.
// - see the issue for the full list). No app chart in this repo used this
// shape before #19; ExerciseMixExplorer (this same PR) is the first real
// consumer, picked because workouts/exercise-category data is already
// fully migrated (Phases 1-3) and already backs the gym page.
//
// Revised twice after feedback. First round: fills render much more solid
// than a typical translucent wash (STACK_FILL_OPACITY below, not the
// shared MARK_SPECS.area.fillOpacity used by InteractiveLine's confidence
// bands) so this reads as an actual filled area chart, and each band gets
// an in-shape label at its widest point when there's room. Second round
// (this one): fills are fully solid, horizontal gridlines were added, and
// the interaction model was rebuilt from a shared date-crosshair (one
// tooltip showing every category at a shared x) to per-band hover - "the
// tooltip should focus on an area (and highlight it) rather than a date."
//
// Data shape is deliberately transposed from InteractiveLine's "N series,
// each with its own points": here every point already carries every
// category's value at one shared x (`values: Record<categoryId, number>`),
// because a stack fundamentally needs one common x per bucket to stack
// against - there's no such thing as "series A's own x positions" the way
// InteractiveLine has to support (independently-sampled series with
// possibly different point counts/spacing).
//
// Stacked vs. proportional is one flag, not two components: both modes
// share the same `d3.stack()` call, differing only in `.offset()`
// (`stackOffsetNone` vs. `stackOffsetExpand`, d3's own built-in 100%-
// normalization - no hand-rolled percentage math needed). `stackOrderNone`
// keeps categories in the caller's given order (bottom to top) rather than
// reordering by value (`stackOrderInsideOut` etc.) - color follows the
// entity, and so does stacking order, per the dataviz skill's fixed-order
// rule.
//
// #456 made the in-band labels the legend, as they were in legacy: the
// separate `Legend` (and its click-to-hide) is gone, each band's label is
// sized to fill the band (`src/lib/viz/area-labels.ts`), and nothing is
// folded into "Other" any more - every category is its own band, with
// slots past the 5th in the muted neutral, individually labelled where
// there's room and always individually hoverable.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const MIN_MAIN_HEIGHT = 160;
// The full MARK_SPECS.bar.surfaceGap (2px), applied entirely to one edge
// of each internal boundary rather than split 1px+1px across both
// neighbors - see the per-layer render loop below for why one-sided is
// simpler here (and avoids a second clamp for the layer above).
const GAP_INSET = MARK_SPECS.bar.surfaceGap;
// A band never gives up more than this fraction of its own thickness to
// the gap. Without it, a stack of hundreds of sub-pixel bands (every
// person in People Impact, now that nothing folds into "Other") would be
// all gap and no band - each one clamped to zero height, leaving the
// card showing through where the tail should be.
const GAP_MAX_SHARE = 0.25;
// Deliberately NOT MARK_SPECS.area.fillOpacity (0.1) - that constant is
// calibrated for a translucent confidence band drawn *behind* a solid
// line (InteractiveLine's `band` series), where staying faint matters
// because multiple bands can visually overlap. Stacked segments never
// overlap each other by construction, so there's no muddying risk. Fully
// solid (1) per explicit follow-up feedback ("make the areas solid") - an
// earlier, partial bump to 0.7 still read as translucent. A separate,
// area-stack-specific constant so bumping it doesn't also change
// InteractiveLine's bands.
const STACK_FILL_OPACITY = 1;
// A non-hovered band's *group* opacity once another band is being
// hovered/focused - dims the rest of the stack so the hovered band reads
// as highlighted, without changing its own fill/line/label colors.
const DIMMED_OPACITY = 0.35;

// In-band labels (#456) - see `src/lib/viz/area-labels.ts` for the
// search itself. Legacy's floor was 5px; 7 is the smallest that's still
// readable on a laptop screen at this weight, and a label too small to
// read is no better than none (the tooltip still names every band).
const LABEL_FIT: LabelFitOptions = { minFont: 7, capFont: 24, padX: 4, padY: 2 };
const LABEL_FONT_WEIGHT = 600;
// Labels are measured once at this size and scaled, rather than re-measured
// at every candidate size - text width is linear in font size.
const MEASURE_FONT_SIZE = 100;

export type InteractiveAreaCategory = {
  id: string;
  label: string;
  /** A shorter name for the in-band label, used when the full `label` only
   * fits small and the alias fits much larger - legacy's fallback rule, see
   * `fitBandLabelWithAlias`. The tooltip always shows the full `label`. */
  alias?: string;
  /** Defaults to `categoricalColor(i)` using this category's index in the
   * `categories` array (fixed slot order) - pass this only to pin a
   * specific slot regardless of array order. */
  color?: string;
};

export type InteractiveAreaPoint = {
  x: Date;
  /** This point's value per category id. A category missing from the map
   * is treated as 0 (not "no data") - every category is assumed to apply
   * at every x, the same "0 workouts that month" shape a stacked count
   * chart actually has. Values are assumed non-negative (a stack's
   * baseline is always 0) - this primitive doesn't support negative
   * values, which #19's scope never called for. */
  values: Record<string, number>;
};

export type InteractiveAreaMode = "stacked" | "proportional";

export type InteractiveAreaProps = {
  categories: InteractiveAreaCategory[];
  /** Oldest first, one shared x per point - same convention as every
   * other chart's data-fetcher in this app (e.g. groupByPeriod's output).
   * Not re-sorted here. */
  points: InteractiveAreaPoint[];
  width: number;
  height: number;
  mode?: InteractiveAreaMode;
  xDomain?: [Date, Date];
  /** Formats a category's raw value for the tooltip row - same raw
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
  /** Overrides `dateFormat` entirely for the tooltip's title - for a
   * caller bucketing by something `DateFormatPreset` has no shape for
   * (a quarter, a bare year), where formatDate's preset table can't help.
   * Receives the hovered point's raw `x`. */
  titleFormat?: (x: Date) => string;
  margin?: Partial<typeof DEFAULT_MARGIN>;
  ariaLabel?: string;
};

type ResolvedCategory = InteractiveAreaCategory & { color: string };
type StackLayer = d3.Series<InteractiveAreaPoint, string>;
type StackPoint = d3.SeriesPoint<InteractiveAreaPoint>;

/** Which band is currently hovered/focused, and which point along it -
 * replaces the old shared-x crosshair entirely. Set from a pointer/focus
 * event on that band's own fill path (see the render effect below), read
 * back here to drive both the highlight (via direct D3 opacity, not
 * React state - see use-d3.ts on why per-frame pointer state must stay
 * outside useD3's own deps) and the single-row tooltip's content/position. */
type HoveredBand = { categoryId: string; pointIndex: number };

/**
 * Rendered width per pixel of font size, measured off a throwaway text node
 * styled like the real label. jsdom has no layout, so tests fall back to a
 * typical average glyph width rather than zero (which would make every
 * label "fit" anywhere).
 */
function measureWidthRatio(parent: d3.Selection<SVGGElement, unknown, null, undefined>, text: string): number {
  const probe = parent
    .append("text")
    .style("font-size", `${MEASURE_FONT_SIZE}px`)
    .style("font-weight", LABEL_FONT_WEIGHT)
    .attr("visibility", "hidden")
    .text(text);
  const node = probe.node() as SVGTextElement;
  const width = typeof node.getComputedTextLength === "function" ? node.getComputedTextLength() : 0;
  probe.remove();
  return width > 0 ? width / MEASURE_FONT_SIZE : text.length * 0.6;
}

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
  titleFormat,
  margin,
  ariaLabel,
}: InteractiveAreaProps) {
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };

  // No hiding any more (#456): the legend that toggled categories is gone,
  // and a click-to-hide on a band's own label would leave no way to bring
  // it back once hidden. Every category is always drawn.
  const visibleCategories = useMemo(() => resolveCategoryColors(categories), [categories]);

  const fullXDomain = useMemo<[Date, Date]>(() => {
    if (xDomain) return xDomain;
    const extent = d3.extent(points, (p) => p.x);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : [new Date(), new Date()];
  }, [xDomain, points]);

  const mainHeight = Math.max(MIN_MAIN_HEIGHT, height);

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

  // Shared between the render effect's fill/line/label geometry below and
  // the hovered-band tooltip's position further down - "how tall is this
  // band at this point" computed exactly once, the same way, everywhere
  // it's needed, so nothing (a label, a highlight, a tooltip) ever works
  // off numbers that don't match what's actually painted.
  function bandPixelBounds(d: StackPoint, isBottom: boolean): [number, number] {
    const rawBottom = y(d[0]);
    const topPx = y(d[1]);
    const gap = Math.min(GAP_INSET, (rawBottom - topPx) * GAP_MAX_SHARE);
    const bottomPx = isBottom ? rawBottom : rawBottom - gap;
    return [bottomPx, topPx];
  }

  const resolvedYTickFormat = yTickFormat ?? (mode === "proportional" ? (v: d3.NumberValue) => formatPercent(+v) : undefined);

  const xPositions = useMemo(() => points.map((p) => x(p.x)), [points, x]);

  // Which band + point is currently hovered/focused - see `HoveredBand`'s
  // own doc comment above.
  const [hovered, setHovered] = useState<HoveredBand | null>(null);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const g = svg
        .attr("width", width)
        .attr("height", mainHeight)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      // Gridlines first so they paint behind the axes and the bands.
      drawYGridlines({ g, y, innerWidth, ticks: 5 });
      drawStandardAxes({ g, x, y, innerWidth, innerHeight, yTicks: 5, yTickFormat: resolvedYTickFormat });

      // Dims every band except `categoryId` (or restores all, for
      // `null`) via each band's own group opacity - direct D3
      // manipulation, not React state, so a pointermove never triggers a
      // full useD3 rebuild (see use-d3.ts's own comment on that rule).
      function setActiveBand(categoryId: string | null) {
        g.selectAll<SVGGElement, unknown>("g.area-band").each(function () {
          const bandSel = d3.select(this);
          const isActive = categoryId === null || bandSel.attr("data-category-id") === categoryId;
          bandSel.style("opacity", isActive ? 1 : DIMMED_OPACITY);
        });
      }

      visibleCategories.forEach((cat, i) => {
        const layer = stacked[i];
        if (!layer) return;
        const isBottom = i === 0;

        // Per band: a solid fill, a solid top-edge line for a crisp
        // boundary against its neighbor, and (when there's room) an
        // in-shape label - all three grouped under one <g>, so hovering
        // any part of the band highlights/dims all of it together as one
        // unit, and so the label dims along with its band rather than
        // staying at full strength while its own fill fades.
        const bandG = g.append("g").attr("class", "area-band").attr("data-category-id", cat.id);

        const areaGen = d3
          .area<StackPoint>()
          .x((d) => x(d.data.x))
          .y0((d) => bandPixelBounds(d, isBottom)[0])
          .y1((d) => bandPixelBounds(d, isBottom)[1])
          .curve(d3.curveMonotoneX);

        const fillPath = bandG
          .append("path")
          .datum(layer)
          .attr("fill", cat.color)
          .attr("fill-opacity", STACK_FILL_OPACITY)
          .attr("stroke", "none")
          .attr("d", areaGen);

        const lineGen = d3
          .line<StackPoint>()
          .x((d) => x(d.data.x))
          .y((d) => y(d[1]))
          .curve(d3.curveMonotoneX);

        bandG
          .append("path")
          .datum(layer)
          .attr("fill", "none")
          .attr("stroke", cat.color)
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("d", lineGen);

        // In-band label - the legend, since #456. The layout search runs
        // here, inside the render, so it re-runs only when the data or
        // dimensions change, never per pointer move (use-d3.ts's rule).
        // Bands that never get thick enough for the smallest label skip
        // measurement entirely, which is most of a long muted tail.
        if (layer.length > 1) {
          const bounds = layer.map((d) => bandPixelBounds(d, isBottom));
          const maxThickness = d3.max(bounds, ([bottomPx, topPx]) => bottomPx - topPx) ?? 0;
          if (maxThickness >= LABEL_FIT.minFont + 2 * (LABEL_FIT.padY ?? 0)) {
            const profile = {
              xs: layer.map((d) => x(d.data.x)),
              bottoms: bounds.map(([bottomPx]) => bottomPx),
              tops: bounds.map(([, topPx]) => topPx),
            };
            const fit = fitBandLabelWithAlias(
              profile,
              { text: cat.label, widthRatio: measureWidthRatio(bandG, cat.label) },
              cat.alias ? { text: cat.alias, widthRatio: measureWidthRatio(bandG, cat.alias) } : null,
              LABEL_FIT,
            );
            if (fit) {
              bandG
                .append("text")
                .attr("class", "area-label")
                .attr("x", fit.x)
                .attr("y", fit.y)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("font-size", `${fit.fontSize}px`)
                .style("font-weight", LABEL_FONT_WEIGHT)
                // Black or white per this band's own painted fill, the
                // same call InteractiveTimeline makes: the fill is a
                // `var(--chart-N)` (or the muted neutral), so it has to be
                // read back resolved before its lightness can be judged.
                .attr("fill", contrastingTextColor(getComputedStyle(fillPath.node() as SVGPathElement).fill))
                // The band underneath owns hover; a label intercepting the
                // pointer would drop the highlight whenever it's crossed.
                .style("pointer-events", "none")
                .text(fit.text);
            }
          }
        }

        // Per-band hover/focus - replaces the old shared date-crosshair
        // entirely. `d3.pointer(event, g.node())` converts the pointer
        // event straight into g's own local coordinate space (the same
        // space xPositions/bandPixelBounds already work in), correctly
        // accounting for g's translate() without any manual client-rect
        // math.
        fillPath
          .attr("tabindex", 0)
          .attr("aria-label", `${cat.label}. Hover or focus and use arrow keys to inspect values.`)
          .style("cursor", "pointer")
          .style("outline", "none")
          .on("pointerenter pointermove", function (event: PointerEvent) {
            if (xPositions.length === 0) return;
            const [localX] = d3.pointer(event, g.node());
            const pointIndex = d3.bisectCenter(xPositions, localX);
            setActiveBand(cat.id);
            setHovered({ categoryId: cat.id, pointIndex });
          })
          .on("pointerleave", () => {
            setActiveBand(null);
            setHovered(null);
          })
          .on("focus", () => {
            if (xPositions.length === 0) return;
            setActiveBand(cat.id);
            setHovered({ categoryId: cat.id, pointIndex: xPositions.length - 1 });
          })
          .on("blur", () => {
            setActiveBand(null);
            setHovered(null);
          })
          .on("keydown", function (event: KeyboardEvent) {
            if (xPositions.length === 0) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setHovered((cur) => ({
                categoryId: cat.id,
                pointIndex: Math.max(0, (cur?.categoryId === cat.id ? cur.pointIndex : xPositions.length) - 1),
              }));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setHovered((cur) => ({
                categoryId: cat.id,
                pointIndex: Math.min(xPositions.length - 1, (cur?.categoryId === cat.id ? cur.pointIndex : -1) + 1),
              }));
            } else if (event.key === "Escape") {
              (event.currentTarget as SVGElement).blur();
            }
          });
      });
    },
    [visibleCategories, stacked, width, mainHeight, x, y, innerWidth, innerHeight, resolvedYTickFormat, xPositions],
  );

  // Resolve the hovered band + point into a single tooltip row - "focus
  // on an area (and highlight it) rather than a date," per feedback, so
  // this is always exactly one row (the hovered band's own value), not
  // every visible category at a shared x the way the old crosshair-driven
  // tooltip worked.
  const hoveredCategoryIndex = hovered ? visibleCategories.findIndex((c) => c.id === hovered.categoryId) : -1;
  const hoveredCategory = hoveredCategoryIndex >= 0 ? visibleCategories[hoveredCategoryIndex] : undefined;
  const hoveredLayer = hoveredCategoryIndex >= 0 ? stacked[hoveredCategoryIndex] : undefined;
  const hoveredDatum = hovered && hoveredLayer ? hoveredLayer[hovered.pointIndex] : undefined;
  const hoveredPoint = hovered ? points[hovered.pointIndex] : undefined;

  let tooltip: { x: number; y: number; title: string; rows: TooltipRow[] } | null = null;
  if (hovered && hoveredCategory && hoveredDatum && hoveredPoint) {
    const [bottomPx, topPx] = bandPixelBounds(hoveredDatum, hoveredCategoryIndex === 0);
    const pixelX = xPositions[hovered.pointIndex] ?? 0;
    tooltip = {
      x: MARGIN.left + pixelX,
      y: MARGIN.top + (bottomPx + topPx) / 2,
      title: titleFormat ? titleFormat(hoveredPoint.x) : formatDate(toDateString(hoveredPoint.x), dateFormat),
      rows: [
        {
          label: hoveredCategory.label,
          value: valueFormat(hoveredPoint.values[hoveredCategory.id] ?? 0),
          color: hoveredCategory.color,
        },
      ],
    };
  }

  return (
    <div style={{ position: "relative", width, height: mainHeight }}>
      <svg
        ref={ref}
        role="img"
        aria-label={ariaLabel ?? "Interactive chart. Hover or focus a band and use arrow keys to inspect its values."}
      />
      {tooltip ? (
        <ChartTooltip x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} containerWidth={width} />
      ) : null}
    </div>
  );
}
