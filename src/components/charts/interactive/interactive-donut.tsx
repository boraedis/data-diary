"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover } from "./marks";
import { ChartTooltip } from "./tooltip";
import { categoricalColor } from "@/lib/viz/color";
import { formatPercent, formatThousandsNumber } from "@/lib/viz/format";
import type { HierarchyDatum } from "@/lib/viz/hierarchy";
import { cn } from "@/lib/utils";

// InteractiveDonut (#118) — the shared radial part-of-whole primitive: a
// zoomable, N-ring sunburst over any `HierarchyDatum` tree.
//
// Scope note, since the issue text left it open: #118 asked whether to
// build a simple single-ring donut or the multi-ring zoomable Sunburst
// legacy actually had (`functions/views/vis/charts/location_burst.js`,
// itself a port of https://observablehq.com/@d3/zoomable-sunburst).
// Resolved with the user in favor of the Sunburst — a single ring is just
// this with `visibleRings={1}` on a depth-1 tree, so the general form
// subsumes the simple one rather than competing with it.
//
// What's carried over from legacy, and what deliberately isn't:
//  - Carried: the zoom-on-click re-centering with the 750ms arc tween,
//    labels rotated to follow the arc with a visibility threshold and
//    font-size tiers, and a center that summarizes whatever node the
//    chart is currently focused on.
//  - Not carried: legacy's hardcoded `cat_colors` place-category -> hex
//    map (colors come from the shared palette or from the entity's own
//    data now — see `color` below), its brightness-derived black/white
//    label fill (impossible against `var(--chart-N)` tokens, which JS
//    can't read; replaced with a surface-colored text halo that works on
//    any fill in either theme), and its `console.log`-only "next cutoff"
//    diagnostics.
//  - Added, because legacy's own gap was called out in #118: a real
//    breadcrumb trail. Legacy zoomed with no "you are here" indicator at
//    all, so three rings deep you could only guess where you were.
//
// Right-click-to-exclude-a-slice (the user's own long-standing want) is
// explicitly NOT here: the hard part isn't the interaction, it's showing
// the excluded weight somewhere that keeps the remaining percentages
// honest, and that needs its own design pass. Filed as follow-up rather
// than half-built here.

/** Arc extent in the layout's own units: `x` is angle in radians [0, 2π],
 * `y` is ring depth (root = 0). The subset of a d3 partition node that
 * gets interpolated during a zoom — see `zoomTo` below. */
export type ArcBox = { x0: number; x1: number; y0: number; y1: number };

type DonutNode = d3.HierarchyRectangularNode<HierarchyDatum>;
/** The layout node plus the two mutable frames the zoom tween runs
 * between: `current` is what's on screen right now, `target` is where the
 * in-flight transition is taking it. Mutated in place (not React state) —
 * this is per-frame animation data, and `useD3`'s deps must never see it. */
type AnimatedNode = DonutNode & { current: ArcBox; target?: ArcBox };

/** Below this angular width an arc is a hairline that can't be seen or
 * clicked; it's cheaper to hide it than to render thousands of them. */
export const MIN_ARC_ANGLE = 0.001;

const ZOOM_DURATION_MS = 750;
/** Height reserved out of the caller's `height` for the breadcrumb row —
 * same fixed-budget approach as InteractiveGeo's LEGEND_AREA_HEIGHT, and
 * for the same reason (the caller's `h-[min(62vh,640px)]` class is a hard
 * cap on the whole component, not just the drawing). */
const BREADCRUMB_AREA_HEIGHT = 32;

// --- Pure geometry helpers (exported for tests) ---------------------------

/**
 * Is this arc inside the currently-visible ring window? `y0 >= 1` hides
 * the focused node itself (it's the center disc, not a ring), and
 * `y1 <= visibleRings + 1` is the outer cutoff — so `visibleRings` counts
 * rings *drawn around* the center, matching how a reader would count them.
 */
export function isArcVisible(box: ArcBox, visibleRings: number): boolean {
  return box.y1 <= visibleRings + 1 && box.y0 >= 1 && box.x1 - box.x0 > MIN_ARC_ANGLE;
}

/** Font-size tiers, largest first — legacy's 1.5rem/1rem/0.75rem ladder,
 * re-expressed in px so it can be compared against measured geometry. */
export const LABEL_FONT_TIERS = [15, 12, 10] as const;
/** Rough mean glyph width as a fraction of font size for the app's sans
 * stack. An estimate on purpose: measuring every label's real advance
 * width (canvas `measureText`, or an off-screen `<text>` + `getBBox`)
 * would mean a forced layout per arc per frame of the zoom tween, and the
 * cost of being wrong here is only that a label is hidden slightly early
 * or clipped slightly late. */
const AVG_GLYPH_WIDTH_RATIO = 0.55;
const LABEL_LINE_HEIGHT_RATIO = 1.25;
/** Breathing room at each end of the radial run, so a label that "fits"
 * doesn't touch the arc's two curved edges. */
const LABEL_RADIAL_PADDING = 10;

/**
 * The largest tier that fits inside this arc, or `null` to hide the label
 * entirely.
 *
 * Labels read radially (rotated to the arc's mid-angle, flipped on the
 * left half — see `labelTransform`), so the text's *length* runs along the
 * ring's thickness and its *height* runs along the arc. Legacy tested this
 * with a value-fraction formula derived from the center node's total
 * (`d.value >= 0.09/((y0+y1)*π) * center.value`), which is the same idea
 * expressed indirectly and breaks the moment the center changes; testing
 * the geometry directly is both clearer and independent of what's focused.
 */
export function labelFontSize(box: ArcBox, radius: number, labelLength: number): number | null {
  if (labelLength <= 0 || radius <= 0) return null;
  const radialRun = (box.y1 - box.y0) * radius - LABEL_RADIAL_PADDING;
  const arcRun = (box.x1 - box.x0) * (((box.y0 + box.y1) / 2) * radius);
  for (const size of LABEL_FONT_TIERS) {
    if (size * LABEL_LINE_HEIGHT_RATIO > arcRun) continue;
    if (labelLength * size * AVG_GLYPH_WIDTH_RATIO > radialRun) continue;
    return size;
  }
  return null;
}

/** Places a label at the arc's mid-angle/mid-radius, rotated to run along
 * the radius, and flipped upside-right on the left half of the circle. */
export function labelTransform(box: ArcBox, radius: number): string {
  const angle = (((box.x0 + box.x1) / 2) * 180) / Math.PI;
  const r = ((box.y0 + box.y1) / 2) * radius;
  return `rotate(${angle - 90}) translate(${r},0) rotate(${angle < 180 ? 0 : 180})`;
}

/** Root-relative path of `key`s identifying a node — the root itself
 * contributes nothing, so `[]` means "the root". Stable across a
 * re-layout (unlike a node object), which is what makes it usable as the
 * remembered focus across a resize. */
export function keyPathOf(node: d3.HierarchyNode<HierarchyDatum>): string[] {
  return node
    .ancestors()
    .reverse()
    .slice(1)
    .map((n) => n.data.key);
}

/** Resolves a `keyPathOf` result back to a live node, or `null` if that
 * path no longer exists (the data changed under a remembered focus). */
export function findByKeyPath<T extends d3.HierarchyNode<HierarchyDatum>>(root: T, path: string[]): T | null {
  let node: T = root;
  for (const key of path) {
    const next = (node.children as T[] | undefined)?.find((child) => child.data.key === key);
    if (!next) return null;
    node = next;
  }
  return node;
}

// --- Color ----------------------------------------------------------------

/**
 * Default fill: every arc takes the color of the depth-1 branch it belongs
 * to, so a whole branch reads as one family and depth is carried by
 * opacity (below) rather than by a second hue.
 *
 * A branch whose data carries its own `color` uses it — that's an
 * author-assigned identity color (`places.color`, set per country), not a
 * palette slot, so there's no "never cycle" concern with having more than
 * five of them. Branches without one fall back to `categoricalColor` by
 * rank, which means the 6th+ branch goes muted by design; a consumer with
 * a long uncolored tail should fold it with `foldTailIntoOther` before
 * passing the tree in.
 */
function defaultColorOf(node: d3.HierarchyNode<HierarchyDatum>): string {
  const branch = node.depth <= 1 ? node : node.ancestors()[node.depth - 1];
  if (branch?.data.color) return branch.data.color;
  const siblings = branch?.parent?.children ?? [];
  return categoricalColor(Math.max(0, siblings.indexOf(branch)));
}

/** Depth's own channel, so ring 3 of a branch doesn't read as the same
 * mark as ring 1: a fixed step down in fill opacity per ring, floored so
 * the deepest ring is still clearly a filled arc and not a ghost. */
function depthOpacity(depth: number): number {
  return Math.max(0.35, 0.85 - 0.16 * Math.max(0, depth - 1));
}

// --- Component ------------------------------------------------------------

export type InteractiveDonutProps = {
  /** The tree to draw. Its own root is the initial center; only its
   * descendants get rings. Build it with `@/lib/viz/hierarchy`'s helpers
   * rather than by hand. */
  data: HierarchyDatum;
  width: number;
  height: number;
  /** How many rings are drawn around the center at once. 2 matches
   * legacy's own hardcoded window; 1 makes this a plain donut. Deeper
   * levels aren't dropped — they're off-screen until you zoom in. */
  visibleRings?: number;
  formatValue?: (value: number) => string;
  /** Noun for the value in the tooltip and center, e.g. "days". */
  valueLabel?: string;
  /** Override the default branch-follows-the-palette fill. Gets the
   * layout node, so it can key off depth, data, or ancestry. */
  color?: (node: d3.HierarchyNode<HierarchyDatum>) => string;
  ariaLabel?: string;
};

export function InteractiveDonut({
  data,
  width,
  height,
  visibleRings = 2,
  formatValue = formatThousandsNumber,
  valueLabel = "total",
  color,
  ariaLabel = "Sunburst chart. Click a slice to zoom into it, click the center to zoom back out. Hover or focus a slice to see its value.",
}: InteractiveDonutProps) {
  const [hovered, setHovered] = useState<{ node: DonutNode; clientPos: { x: number; y: number } } | null>(null);
  // A state-backed callback ref, not a plain useRef — see interactive-
  // hist's own comment on why this has to be state, not a ref read during
  // render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // Which node the chart is currently zoomed into, as a key path.
  //
  // Ordinary React state, but deliberately NOT a `useD3` dependency: if a
  // zoom re-ran the render function, it would tear the whole SVG down and
  // rebuild it mid-transition — the animation this primitive exists for.
  // The d3 render function still reads this value directly and gets the
  // current one: `useD3` re-runs on a dependency change using the closure
  // from the latest render, so a resize-driven rebuild picks up wherever
  // the user had zoomed to instead of snapping back to the root.
  const [focusPath, setFocusPath] = useState<string[]>([]);
  /** Set by the d3 render function so the React breadcrumb can drive the
   * same zoom the arcs do, instead of a second, differently-animated code
   * path. */
  const zoomToPathRef = useRef<((path: string[]) => void) | null>(null);

  const chartHeight = Math.max(0, height - BREADCRUMB_AREA_HEIGHT);
  // The center disc plus `visibleRings` rings have to fit the smaller of
  // the two dimensions, so a unit of radius is that over the number of
  // bands sharing it.
  const radius = Math.min(width, chartHeight) / (2 * (visibleRings + 1));

  // Depends only on `data` — the partition is in angle/depth units, and
  // pixel radius is applied at draw time, so a resize reuses this layout
  // (and with it every node's in-flight `current` frame) instead of
  // resetting the view.
  const layout = useMemo(() => {
    const root = d3
      .hierarchy(data)
      .sum((d) => Math.max(0, d.value ?? 0))
      // Descending value, so the biggest slice starts at 12 o'clock and
      // the ring reads as a ranking clockwise — and so a branch's palette
      // index below is its rank, not DB row order.
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) as DonutNode;
    const partitioned = d3.partition<HierarchyDatum>().size([2 * Math.PI, root.height + 1])(root) as DonutNode;
    partitioned.each((d) => {
      (d as AnimatedNode).current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
    });
    return partitioned;
  }, [data]);

  // New data means the remembered focus is meaningless — reset both
  // copies. Written as React's documented "adjust state when a prop
  // changes" pattern (compare against the previous value *during* render)
  // rather than an effect: an effect would reset one render too late,
  // leaving the breadcrumb briefly claiming a path that no longer exists,
  // and `react-hooks/set-state-in-effect` rightly rejects it.
  const [renderedLayout, setRenderedLayout] = useState(layout);
  if (renderedLayout !== layout) {
    setRenderedLayout(layout);
    setFocusPath([]);
  }

  const resolveColor = useMemo(() => color ?? defaultColorOf, [color]);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (radius <= 0 || layout.height < 1) return;

      const root = layout;
      let focus = (findByKeyPath(root, focusPath) ?? root) as AnimatedNode;

      const arc = d3
        .arc<ArcBox>()
        .startAngle((d) => d.x0)
        .endAngle((d) => d.x1)
        .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
        .padRadius(radius * 1.5)
        .innerRadius((d) => d.y0 * radius)
        // The -1 is the surface-colored seam between concentric rings —
        // MARK_SPECS' `surfaceGap` idea ("separate neighbors with a gap,
        // not a stroke"), in the radial direction.
        .outerRadius((d) => Math.max(d.y0 * radius, d.y1 * radius - 1));

      const g = svg
        .attr("width", width)
        .attr("height", chartHeight)
        // Origin at the center of the drawing area, so every arc/label
        // transform below is written in plain polar terms.
        .attr("viewBox", [-width / 2, -chartHeight / 2, width, chartHeight].join(" "))
        .attr("text-anchor", "middle")
        .append("g");

      const nodes = root.descendants().slice(1) as AnimatedNode[];

      const paths = g
        .append("g")
        .selectAll<SVGPathElement, AnimatedNode>("path")
        .data(nodes)
        .join("path")
        .attr("fill", (d) => resolveColor(d))
        .attr("fill-opacity", (d) => (isArcVisible(d.current, visibleRings) ? depthOpacity(d.depth) : 0))
        .attr("pointer-events", (d) => (isArcVisible(d.current, visibleRings) ? "auto" : "none"))
        .attr("d", (d) => arc(d.current));

      const labels = g
        .append("g")
        .attr("pointer-events", "none")
        .style("user-select", "none")
        .selectAll<SVGTextElement, AnimatedNode>("text")
        .data(nodes)
        .join("text")
        .attr("dy", "0.35em")
        .attr("fill", "var(--foreground)")
        // A surface-colored halo behind the glyphs (stroke painted first,
        // then fill) instead of legacy's compute-black-or-white-from-the-
        // hex trick: fills here are `var(--chart-N)` tokens that JS can't
        // read a brightness from, and the halo is legible over any fill in
        // either theme anyway.
        .attr("stroke", "var(--card)")
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .attr("paint-order", "stroke")
        .text((d) => d.data.name)
        .style("font-size", (d) => sizePx(d.current, d.data.name))
        // `opacity`, not the `fill-opacity` the Observable original fades
        // labels with: these labels carry a surface-colored halo stroke,
        // and zeroing only the fill leaves that stroke painting a white
        // smear over every arc too small to be labelled — which is most of
        // them on a long-tailed hierarchy.
        .attr("opacity", (d) => (isLabelDrawn(d.current, d.data.name) ? 1 : 0))
        .attr("transform", (d) => labelTransform(d.current, radius));

      function sizePx(box: ArcBox, name: string): string | null {
        const size = isArcVisible(box, visibleRings) ? labelFontSize(box, radius, name.length) : null;
        return size === null ? null : `${size}px`;
      }
      function isLabelDrawn(box: ArcBox, name: string): boolean {
        return isArcVisible(box, visibleRings) && labelFontSize(box, radius, name.length) !== null;
      }

      // The center disc: a real target for "zoom back out one level," and
      // the thing the React center summary sits on top of (that overlay is
      // pointer-events:none precisely so clicks land here).
      const center = g
        .append("circle")
        .datum(focus.parent ?? root)
        .attr("r", radius)
        .attr("fill", "none")
        .attr("pointer-events", "all")
        .style("cursor", "pointer")
        .on("click", (_event, d) => zoomTo(d as AnimatedNode));

      function zoomTo(target: AnimatedNode) {
        // A zero-width focus can't define a frame to map the tree into
        // (every arc would divide by zero); leave the view alone.
        if (!(target.x1 > target.x0)) return;

        focus = target;
        setFocusPath(keyPathOf(target));
        center.datum(target.parent ?? root);

        root.each((node) => {
          (node as AnimatedNode).target = {
            x0: Math.max(0, Math.min(1, (node.x0 - target.x0) / (target.x1 - target.x0))) * 2 * Math.PI,
            x1: Math.max(0, Math.min(1, (node.x1 - target.x0) / (target.x1 - target.x0))) * 2 * Math.PI,
            y0: Math.max(0, node.y0 - target.depth),
            y1: Math.max(0, node.y1 - target.depth),
          };
        });

        // One transition object shared by the arcs and the labels, so
        // they're scheduled together rather than as two independently-
        // timed animations. Widened to `BaseType` because d3's typings
        // make `selection.transition(t)` contravariant in the element
        // type, and this `t` is typed to the <g> it was created on.
        const t = g.transition().duration(ZOOM_DURATION_MS) as unknown as d3.Transition<
          d3.BaseType,
          unknown,
          d3.BaseType,
          unknown
        >;

        // Tween every arc's data, even ones that stay invisible, so an
        // interrupted transition leaves them somewhere coherent to start
        // the next one from (straight from the Observable original — the
        // alternative is arcs flying in from stale positions when you
        // click twice quickly).
        paths
          .transition(t)
          .tween("data", (d) => {
            const interpolate = d3.interpolate(d.current, d.target as ArcBox);
            return (time: number) => {
              d.current = interpolate(time);
            };
          })
          .filter(function (d) {
            return Boolean(Number(this.getAttribute("fill-opacity"))) || isArcVisible(d.target as ArcBox, visibleRings);
          })
          .attr("fill-opacity", (d) => (isArcVisible(d.target as ArcBox, visibleRings) ? depthOpacity(d.depth) : 0))
          .attr("pointer-events", (d) => (isArcVisible(d.target as ArcBox, visibleRings) ? "auto" : "none"))
          .attrTween("d", (d) => () => arc(d.current) ?? "");

        // Keyboard reachability has to track visibility too, or Tab walks
        // through arcs that aren't on screen. Set outside the transition
        // (immediately, not eased) — a focus ring appearing mid-fade would
        // be worse than a slightly early one.
        paths.attr("tabindex", (d) => (isArcVisible(d.target as ArcBox, visibleRings) ? 0 : -1));

        labels
          .filter(function (d) {
            return Boolean(Number(this.getAttribute("opacity"))) || isLabelDrawn(d.target as ArcBox, d.data.name);
          })
          .transition(t)
          .attr("opacity", (d) => (isLabelDrawn(d.target as ArcBox, d.data.name) ? 1 : 0))
          .style("font-size", (d) => sizePx(d.target as ArcBox, d.data.name))
          .attrTween("transform", (d) => () => labelTransform(d.current, radius));
      }

      zoomToPathRef.current = (path) => {
        const target = findByKeyPath(root, path);
        if (target) zoomTo(target as AnimatedNode);
      };

      attachMarkHover<AnimatedNode>(
        paths as unknown as d3.Selection<d3.BaseType, AnimatedNode, d3.BaseType, unknown>,
        {
          onHover: (node, clientPos) => setHovered({ node, clientPos }),
          onLeave: () => setHovered(null),
        },
      );

      // Two corrections to what attachMarkHover sets by default, both
      // specific to arcs living outside the visible ring window:
      //  - tabindex 0 on every mark would put off-screen arcs in the tab
      //    order (they're `pointer-events: none`, so the mouse can't reach
      //    them, but the keyboard could);
      //  - a pointer cursor promises a zoom that a childless leaf can't
      //    deliver.
      paths
        .attr("tabindex", (d) => (isArcVisible(d.current, visibleRings) ? 0 : -1))
        .style("cursor", (d) => (d.children ? "pointer" : "default"))
        .on("click", (event, d) => {
          // Only a node with children has anything to zoom *into*;
          // clicking a leaf would just re-frame the ring it's already in.
          if (d.children) zoomTo(d);
          // Without this the click also reaches the center disc behind the
          // ring and immediately zooms back out.
          event.stopPropagation();
        })
        .on("keydown", (event: KeyboardEvent, d) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (d.children) zoomTo(d);
          } else if (event.key === "Escape" || event.key === "Backspace") {
            event.preventDefault();
            zoomTo((focus.parent ?? root) as AnimatedNode);
          }
        });

      return () => {
        zoomToPathRef.current = null;
      };
    },
    [layout, width, chartHeight, radius, visibleRings, resolveColor],
  );

  // --- Breadcrumb + center summary (React, deliberately outside useD3) ---
  // Both are ordinary UI driven by `focusPath`, which changes only on a
  // click. Rendering them here rather than as SVG text keeps real
  // typography, wrapping and focus handling — and, more importantly, keeps
  // `focusPath` out of the d3 dependency array.

  const focusNode = useMemo(() => findByKeyPath(layout, focusPath) ?? layout, [layout, focusPath]);
  const trail = useMemo(() => focusNode.ancestors().reverse(), [focusNode]);
  const grandTotal = layout.value ?? 0;
  const focusTotal = focusNode.value ?? 0;

  const navigate = useCallback((node: d3.HierarchyNode<HierarchyDatum>) => {
    zoomToPathRef.current?.(keyPathOf(node));
  }, []);

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredNode = hovered?.node;

  return (
    <div style={{ width, height }} className="flex flex-col">
      <nav
        aria-label="Chart drill-down path"
        style={{ height: BREADCRUMB_AREA_HEIGHT }}
        className="flex items-center gap-1 overflow-x-auto text-xs text-muted-foreground"
      >
        {trail.map((node, i) => (
          <span key={node.data.key} className="flex shrink-0 items-center gap-1">
            {i > 0 ? <span aria-hidden>/</span> : null}
            <button
              type="button"
              // The last crumb is where you already are — a button that
              // does nothing is worse than plain text, so it reads as the
              // current position instead.
              disabled={i === trail.length - 1}
              onClick={() => navigate(node)}
              className={cn(
                "rounded px-1 py-0.5",
                i === trail.length - 1 ? "font-medium text-foreground" : "hover:bg-accent hover:text-foreground",
              )}
            >
              {node.data.name}
            </button>
          </span>
        ))}
      </nav>

      <div
        ref={setContainerEl}
        style={{ position: "relative", width, height: chartHeight }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg ref={ref} />

        {/* pointer-events-none throughout: the center disc inside the SVG
            is the click target for zooming out, and this sits on top of it.
            A polite live region, so a zoom announces where it landed —
            without it the only feedback for a screen reader user is that
            the arcs silently changed underneath them. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            role="status"
            aria-live="polite"
            aria-label="Current selection"
            className="text-center"
            style={{ maxWidth: radius * 1.7 }}
          >
            <div className="text-sm leading-tight font-medium break-words text-foreground">{focusNode.data.name}</div>
            <div className="mt-0.5 text-lg leading-none font-semibold tabular-nums text-foreground">
              {formatValue(focusTotal)}
            </div>
            <div className="text-[10px] text-muted-foreground">{valueLabel}</div>
            {focusNode.parent ? (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {formatPercent(grandTotal > 0 ? focusTotal / grandTotal : 0, 1)} of {layout.data.name}
              </div>
            ) : null}
          </div>
        </div>

        {hovered && hoveredNode && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            // Full ancestry, not just the node's own name: three rings
            // deep, "Midtown" alone doesn't say which city's Midtown.
            title={hoveredNode
              .ancestors()
              .reverse()
              .slice(1)
              .map((n) => n.data.name)
              .join(" / ")}
            rows={[
              {
                label: valueLabel,
                value: formatValue(hoveredNode.value ?? 0),
                color: resolveColor(hoveredNode),
                variant: "swatch",
              },
              {
                // Share of the parent, not of the grand total — inside a
                // zoomed branch, "8% of everything" is a number the reader
                // has to do arithmetic on; "8% of Georgia" is the one the
                // ring is actually drawn to show.
                label: `of ${hoveredNode.parent?.data.name ?? layout.data.name}`,
                value: formatPercent(
                  (hoveredNode.parent?.value ?? 0) > 0
                    ? (hoveredNode.value ?? 0) / (hoveredNode.parent?.value ?? 1)
                    : 0,
                  1,
                ),
                color: resolveColor(hoveredNode),
                variant: "swatch",
              },
            ]}
            containerWidth={width}
          />
        ) : null}
      </div>
    </div>
  );
}
