"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { toDateString } from "@/lib/date";
import { formatDate, formatPercent, type DateFormatPreset } from "@/lib/viz/format";
import { categoricalColor } from "@/lib/viz/color";
import { drawStandardAxes, drawYGridlines } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { Legend } from "./legend";

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

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const LEGEND_HEIGHT = 28;
const MIN_MAIN_HEIGHT = 160;
// The full MARK_SPECS.bar.surfaceGap (2px), applied entirely to one edge
// of each internal boundary rather than split 1px+1px across both
// neighbors - see the per-layer render loop below for why one-sided is
// simpler here (and avoids a second clamp for the layer above).
const GAP_INSET = MARK_SPECS.bar.surfaceGap;
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

// In-band label placement (per-layer, inside the render loop below): find
// the band's single widest point, then confirm a real measured label
// actually fits in a contiguous run of sufficiently-thick points around
// it before committing to drawing it there. Thresholds loosened this
// round ("where are the labels I asked for") - the real root cause was
// almost certainly the chart's own height (see exercise-mix-explorer.tsx:
// it was rendering at a smaller height than every other chart page in the
// app, leaving little vertical room for any one band in a multi-category
// stack to clear the old, stricter minimum), but the thresholds below are
// also given more headroom as insurance against genuinely thin bands.
const LABEL_FONT_SIZE = 11;
// Minimum band thickness, px, for a label to be considered at all -
// font size plus a little breathing room above/below the text.
const LABEL_MIN_THICKNESS = LABEL_FONT_SIZE + 4;
// Horizontal breathing room required on either side of the measured
// label width, within the qualifying run, before it counts as "fits."
const LABEL_PADDING_X = 6;

export type InteractiveAreaCategory = {
  id: string;
  label: string;
  /** Defaults to `categoricalColor(i)` using this category's index in the
   * *original* `categories` array (fixed slot order) - pass this only to
   * pin a specific slot regardless of array order. Resolved once up front
   * from the full list, before any hiding/filtering, so a toggled-off
   * category never causes the survivors to shift color (see Legend's own
   * doc comment on the same rule). */
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

  const resolvedCategories = useMemo(() => resolveCategoryColors(categories), [categories]);

  // Click-to-toggle state lives here, not in the caller - the same "it's
  // just part of how this primitive works" ownership InteractiveLine's
  // zoom state has, so every consumer gets it for free rather than having
  // to wire up its own hidden-set plumbing.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCategory = (id: string) =>
    setHiddenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Refuse to hide the last visible category - an empty stack isn't a
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

  // Shared between the render effect's fill/line/label geometry below and
  // the hovered-band tooltip's position further down - "how tall is this
  // band at this point" computed exactly once, the same way, everywhere
  // it's needed, so nothing (a label, a highlight, a tooltip) ever works
  // off numbers that don't match what's actually painted.
  function bandPixelBounds(d: StackPoint, isBottom: boolean): [number, number] {
    const rawBottom = y(d[0]);
    const topPx = y(d[1]);
    const bottomPx = isBottom ? rawBottom : Math.max(rawBottom - GAP_INSET, topPx);
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

        // In-shape label: find this band's single widest point (by pixel
        // thickness), then walk outward from it while thickness stays
        // above the legibility floor to find the full contiguous run it
        // sits inside - the run's pixel width is what actually has to fit
        // the label, not just the one (possibly needle-thin between two
        // wide neighbors) peak point. Placed and measured for real via
        // getComputedTextLength() rather than a guessed chars-per-px
        // ratio, then removed if it genuinely doesn't fit anywhere on
        // this band - a label overlapping its neighbor is worse than no
        // label, and the legend + tooltip both still say what this band
        // is either way.
        if (layer.length > 0) {
          const xs = layer.map((d) => x(d.data.x));
          const bounds = layer.map((d) => bandPixelBounds(d, isBottom));
          const thickness = bounds.map(([bottomPx, topPx]) => bottomPx - topPx);

          let peakIndex = 0;
          for (let j = 1; j < thickness.length; j++) {
            if (thickness[j] > thickness[peakIndex]) peakIndex = j;
          }

          if (thickness[peakIndex] >= LABEL_MIN_THICKNESS) {
            const [peakBottom, peakTop] = bounds[peakIndex];
            const label = bandG
              .append("text")
              .attr("x", xs[peakIndex])
              .attr("y", (peakBottom + peakTop) / 2)
              .attr("text-anchor", "middle")
              .attr("dominant-baseline", "central")
              .style("font-size", `${LABEL_FONT_SIZE}px`)
              .style("font-weight", 600)
              // A stroked halo behind the fill, not a plain fill color -
              // the label sits on whatever hue this category's color
              // happens to be (any of the fixed 5 categorical slots, or
              // the muted overflow gray for a 6th+ category), so a single
              // fixed fill color can't guarantee contrast on its own the
              // way it could against one known surface color.
              .attr("paint-order", "stroke")
              .attr("stroke", "var(--card)")
              .attr("stroke-width", 3)
              .attr("stroke-linejoin", "round")
              .attr("fill", "var(--foreground)")
              .text(cat.label);

            const labelWidth = (label.node() as SVGTextElement).getComputedTextLength();

            let lo = peakIndex;
            let hi = peakIndex;
            while (lo > 0 && thickness[lo - 1] >= LABEL_MIN_THICKNESS) lo--;
            while (hi < thickness.length - 1 && thickness[hi + 1] >= LABEL_MIN_THICKNESS) hi++;
            const availableWidth = xs[hi] - xs[lo];

            if (availableWidth < labelWidth + LABEL_PADDING_X) {
              label.remove();
            } else {
              // Center within the whole qualifying run, not pinned to the
              // single peak point - reads better when the peak sits near
              // one edge of an otherwise-wide-enough stretch.
              label.attr("x", (xs[lo] + xs[hi]) / 2);
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
        <svg
          ref={ref}
          role="img"
          aria-label={ariaLabel ?? "Interactive chart. Hover or focus a band and use arrow keys to inspect its values."}
        />
        {tooltip ? (
          <ChartTooltip x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} containerWidth={width} />
        ) : null}
      </div>
    </div>
  );
}
