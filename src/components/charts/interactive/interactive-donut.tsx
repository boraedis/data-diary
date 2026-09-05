"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
//  - Rebuilt around a focus-windowed data join, which the Observable
//    original (sized for a ~250-node demo tree) has no need for and this
//    app very much does. See `isArcInPlay` for the measurements and the
//    reasoning; the short version is that only what's on screen exists in
//    the DOM, and the other ~1,900 nodes live purely as numbers.
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
 * in-flight transition is taking it. Both are mutated in place (never
 * reallocated) — this is per-frame animation data on every node in the
 * tree, and it must cost nothing and never reach React state.
 *
 * `uid` is a stable identity for the data join below; `data.key` is only
 * unique among siblings, and the join is across the whole tree. */
type AnimatedNode = DonutNode & { current: ArcBox; target: ArcBox; uid: number };

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

/**
 * Should this node exist in the DOM at all right now?
 *
 * This is the whole performance story of the primitive. A real hierarchy
 * here is ~2,100 nodes across six levels, of which about 160 arcs and a
 * dozen labels are ever on screen — rendering all of them (as the
 * Observable original does, sized for a ~250-node demo tree) meant 4,200
 * SVG elements, a 1.5s mount, a zoom that dropped two thirds of its
 * frames, and a 10ms forced layout on every single pointer move. So the
 * arcs and labels are a keyed data join over just the nodes in play, and
 * everything else lives purely as numbers.
 *
 * "In play" is the union of the current frame and the frame a zoom is
 * heading for — a node's `[y0, y1]` span, taken across both, has to
 * overlap the visible ring window `[1, visibleRings + 1]`. Taking the
 * union matters for two reasons: an arc animating *into* view has to be
 * mounted before the transition starts (it enters at its pre-zoom
 * geometry, so it flies in from the right place), and a multi-level
 * breadcrumb jump sweeps arcs through the window that are outside it at
 * both ends. Because the union is always a superset of the previous
 * frame's set, a transition never has an exit selection; stale arcs are
 * shed by the settling redraw once it finishes.
 */
export function isArcInPlay(current: ArcBox, target: ArcBox, visibleRings: number): boolean {
  const outer = Math.max(current.y1, target.y1);
  const inner = Math.min(current.y0, target.y0);
  if (outer <= 1 || inner >= visibleRings + 1) return false;
  return current.x1 - current.x0 > MIN_ARC_ANGLE || target.x1 - target.x0 > MIN_ARC_ANGLE;
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
/** Arc height a line of text needs, as a multiple of its font size —
 * the glyphs plus enough clearance that two labels on adjacent hairline
 * arcs don't run into each other's halo strokes (1.25, just the line box,
 * left neighbours like "Florida" and "Rhode Island" visibly touching). */
const LABEL_LINE_HEIGHT_RATIO = 1.45;
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
export function labelFontSize(box: ArcBox, radius: number, labelLength: number, lineCount = 1): number | null {
  if (labelLength <= 0 || radius <= 0 || lineCount < 1) return null;
  const radialRun = (box.y1 - box.y0) * radius - LABEL_RADIAL_PADDING;
  const arcRun = (box.x1 - box.x0) * (((box.y0 + box.y1) / 2) * radius);
  for (const size of LABEL_FONT_TIERS) {
    // Lines stack across the arc, so a second line costs arc height, not
    // radial run — which is exactly why wrapping helps here: the arc is
    // usually the dimension with room to spare.
    if (size * LABEL_LINE_HEIGHT_RATIO * lineCount > arcRun) continue;
    if (labelLength * size * AVG_GLYPH_WIDTH_RATIO > radialRun) continue;
    return size;
  }
  return null;
}

/** Splits at the space nearest the middle, or `null` when there's no
 * space to split on (a single long word can't be wrapped without
 * hyphenation, which reads worse than falling back to a short name). */
export function splitIntoTwoLines(text: string): [string, string] | null {
  const spaces: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === " ") spaces.push(i);
  if (spaces.length === 0) return null;
  const middle = text.length / 2;
  const at = spaces.reduce((best, i) => (Math.abs(i - middle) < Math.abs(best - middle) ? i : best), spaces[0]);
  const head = text.slice(0, at).trim();
  const tail = text.slice(at + 1).trim();
  if (!head || !tail) return null;
  return [head, tail];
}

export type ResolvedLabel = { lines: string[]; size: number };

/**
 * The best label this arc can actually show, or `null` for none.
 *
 * Two escape hatches for a name that doesn't fit on one line, tried in
 * this order:
 *  1. **Wrap it across two lines.** Lines stack tangentially, and on a
 *     wide arc that's the dimension with room going spare, so this often
 *     rescues a name the ring's thickness alone can't hold.
 *  2. **Fall back to `shortName`** — for places that's the catalog alias,
 *     which is what legacy used too (`location_burst.js` swapped in the
 *     alias for any name of 15 characters or more, though it decided that
 *     by string length rather than by whether the label actually fit).
 *
 * The full name always wins over the alias, even at a smaller size: an
 * abbreviation the reader has to decode is a worse trade than a smaller
 * font. Whichever text is chosen, the tooltip and breadcrumb still show
 * the full name — the shorthand never becomes the only spelling on offer.
 */
export function resolveLabel(
  box: ArcBox,
  radius: number,
  name: string,
  shortName?: string,
): ResolvedLabel | null {
  const candidates = shortName && shortName !== name ? [name, shortName] : [name];
  for (const text of candidates) {
    const single = labelFontSize(box, radius, text.length, 1);
    const wrapped = splitIntoTwoLines(text);
    const double = wrapped
      ? labelFontSize(box, radius, Math.max(wrapped[0].length, wrapped[1].length), 2)
      : null;
    // Bigger type wins; on a tie the single line wins, since a wrap the
    // arc didn't need is just two short lines where one would do.
    if (single !== null && (double === null || single >= double)) return { lines: [text], size: single };
    if (double !== null && wrapped) return { lines: [...wrapped], size: double };
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

/**
 * How much white is mixed into a branch's base color at each ring out
 * from the center. Index 0 is the innermost visible ring, which always
 * gets the color at full strength.
 *
 * This used to be a fill-opacity ramp (0.85 down to 0.35, the Observable
 * original's idea), and on the app's dark theme that was plainly wrong:
 * fading a fill toward a dark surface doesn't lighten it, it drains it,
 * so the outer rings went muddy and the whole chart read as washed out.
 * Mixing toward white instead lightens in both themes and holds far more
 * chroma than blending against the background ever could — even in light
 * mode, where the old ramp was effectively a 47% white mix by the third
 * ring, this is 19%.
 *
 * Steps are relative to whatever is currently focused, not to absolute
 * tree depth, so the innermost ring is full-strength at every zoom level
 * rather than the palette draining away the deeper you drill.
 */
const DEPTH_TINTS = [0, 0.1, 0.19, 0.26, 0.32] as const;

/**
 * Base color for a node, tinted for its ring. Deliberately a CSS
 * `color-mix()` string rather than a color computed in JS: the base is
 * usually a `var(--chart-N)` token, and resolving that to real channel
 * values would freeze the chart at whichever theme was live when it
 * rendered. Letting CSS do the mixing keeps light/dark switching
 * automatic, and lets a plain CSS transition interpolate the fill during
 * a zoom (see `draw`) — d3 can't tween these strings, but the browser
 * interpolates their computed colors natively.
 */
export function depthFill(base: string, ringIndex: number): string {
  const tint = DEPTH_TINTS[Math.min(Math.max(ringIndex, 0), DEPTH_TINTS.length - 1)];
  if (tint === 0) return base;
  return `color-mix(in oklch, ${base}, white ${Math.round(tint * 100)}%)`;
}

/** Writes `from` into `to` without allocating a new box. */
function copyBox(from: ArcBox, to: ArcBox): void {
  to.x0 = from.x0;
  to.x1 = from.x1;
  to.y0 = from.y0;
  to.y1 = from.y1;
}

/** Join key. `data.key` is only unique among siblings; the join below is
 * across the whole tree, so it uses the per-layout ordinal instead. */
function keyOfNode(node: AnimatedNode): number {
  return node.uid;
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
  // Container-*local* coordinates, resolved when the hover happens rather
  // than during render — see `readContainerRect` below for why that
  // distinction is the difference between a smooth hover and a janky one.
  const [hovered, setHovered] = useState<{ node: DonutNode; x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Cached bounding box of the plot area, invalidated on scroll and
   * resize rather than re-measured per event.
   *
   * `getBoundingClientRect` forces a synchronous layout, and on a chart
   * this size that measured at ~10ms a call — paid on every single
   * pointermove by the obvious version of this (reading the rect during
   * render, the way the other primitives here do). Nothing but a scroll
   * or a resize can move the container, so those are what invalidate it.
   */
  const containerRectRef = useRef<DOMRect | null>(null);
  const readContainerRect = useCallback((): DOMRect | null => {
    if (!containerRectRef.current) {
      containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
    }
    return containerRectRef.current;
  }, []);

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
  useEffect(() => {
    const invalidate = () => {
      containerRectRef.current = null;
    };
    // Capture phase, so a scroll inside any ancestor counts, not just the
    // window's own.
    window.addEventListener("scroll", invalidate, true);
    window.addEventListener("resize", invalidate);
    return () => {
      window.removeEventListener("scroll", invalidate, true);
      window.removeEventListener("resize", invalidate);
    };
  }, []);

  // The chart's own size changing moves the plot area too, and that
  // arrives as a prop rather than as a window event.
  useEffect(() => {
    containerRectRef.current = null;
  }, [width, chartHeight]);

  const layout = useMemo(() => {
    const root = d3
      .hierarchy(data)
      .sum((d) => Math.max(0, d.value ?? 0))
      // Descending value, so the biggest slice starts at 12 o'clock and
      // the ring reads as a ranking clockwise — and so a branch's palette
      // index below is its rank, not DB row order.
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) as DonutNode;
    const partitioned = d3.partition<HierarchyDatum>().size([2 * Math.PI, root.height + 1])(root) as DonutNode;
    let uid = 0;
    partitioned.each((d) => {
      const node = d as AnimatedNode;
      node.uid = uid++;
      node.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
      node.target = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
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
      const nodes = root.descendants().slice(1) as AnimatedNode[];

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

      const arcLayer = g.append("g");
      const labelLayer = g.append("g").attr("pointer-events", "none").style("user-select", "none");

      function labelFor(box: ArcBox, d: AnimatedNode): ResolvedLabel | null {
        return isArcVisible(box, visibleRings) ? resolveLabel(box, radius, d.data.name, d.data.shortName) : null;
      }

      /** Ring this node sits on, counting out from whatever is focused —
       * 1 is the innermost visible ring. Ancestors of the focus clamp to
       * 1; they're off-screen anyway. */
      function ringIndexOf(d: AnimatedNode): number {
        return Math.max(1, d.depth - focus.depth);
      }

      function fillFor(d: AnimatedNode): string {
        return depthFill(resolveColor(d), ringIndexOf(d) - 1);
      }

      /** Rewrites a label's `<tspan>` lines and size for the given frame.
       * Content is painted for the frame being animated *to*, so a label
       * fades in already reading the way it will when the chart settles
       * rather than re-flowing mid-flight. */
      function paintLabels(
        selection: d3.Selection<SVGTextElement, AnimatedNode, SVGGElement, unknown>,
        boxOf: (d: AnimatedNode) => ArcBox,
      ) {
        selection.each(function (d) {
          const resolved = labelFor(boxOf(d), d);
          const lines = resolved?.lines ?? [];
          const text = d3.select(this);
          if (resolved) text.style("font-size", `${resolved.size}px`);
          else text.style("font-size", null);
          text
            .selectAll<SVGTSpanElement, string>("tspan")
            .data(lines)
            .join("tspan")
            .attr("x", 0)
            // First line lifts by half a line when there are two, so the
            // block stays centered on the arc's mid-angle; the second is
            // one line height further round.
            .attr("dy", (_line, i) => (i === 0 ? (lines.length > 1 ? "-0.22em" : "0.35em") : "1.15em"))
            .text((line) => line);
        });
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

      /**
       * Renders whatever is in play (see `isArcInPlay`) as a keyed join,
       * either snapped straight to the target frame or eased into it.
       *
       * Anything not in play has its `current` snapped to `target` right
       * here: it owns no DOM, so there is nothing to animate and nothing
       * to see, but its geometry still has to be right for the moment a
       * later zoom brings it back on screen.
       */
      function draw(animate: boolean) {
        const inPlay: AnimatedNode[] = [];
        for (const node of nodes) {
          if (isArcInPlay(node.current, node.target, visibleRings)) inPlay.push(node);
          else copyBox(node.target, node.current);
        }

        const joined = arcLayer.selectAll<SVGPathElement, AnimatedNode>("path").data(inPlay, keyOfNode);

        // Entering arcs start at their *pre-zoom* geometry, which is what
        // lets a node that owned no DOM a moment ago still fly in from the
        // right place instead of popping into existence at its endpoint.
        const entered = joined
          .enter()
          .append("path")
          .attr("d", (d) => arc(d.current) ?? "")
          .attr("fill-opacity", (d) => (isArcVisible(d.current, visibleRings) ? 1 : 0))
          // A plain CSS transition on `fill`, because the tint is a
          // `color-mix()` string d3 can't interpolate but the browser
          // can. Harmless on a static draw (nothing changes) and on enter
          // (no previous value to ease from).
          .style("transition", `fill ${ZOOM_DURATION_MS}ms`);

        attachMarkHover<AnimatedNode>(
          entered as unknown as d3.Selection<d3.BaseType, AnimatedNode, d3.BaseType, unknown>,
          {
            onHover: (node, clientPos) => {
              const rect = readContainerRect();
              setHovered({ node, x: clientPos.x - (rect?.left ?? 0), y: clientPos.y - (rect?.top ?? 0) });
            },
            onLeave: () => setHovered(null),
          },
        );

        // Two corrections to what attachMarkHover sets by default:
        //  - tabindex 0 on every mark would put arcs outside the visible
        //    ring window into the tab order (they're `pointer-events:
        //    none`, so the mouse can't reach them, but the keyboard
        //    could) — the real value is set on the merged selection below;
        //  - a pointer cursor promises a zoom that a childless leaf can't
        //    deliver.
        entered
          .style("cursor", (d) => (d.children ? "pointer" : "default"))
          .on("click", (event, d) => {
            // Only a node with children has anything to zoom *into*;
            // clicking a leaf would just re-frame the ring it's already in.
            if (d.children) zoomTo(d);
            // Without this the click also reaches the center disc behind
            // the ring and immediately zooms back out.
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

        const arcs = entered.merge(joined);

        // Hit-testing and keyboard reachability jump straight to the
        // target state rather than easing: a focus ring or a click that
        // only works once the animation settles reads as the chart being
        // unresponsive.
        arcs
          .attr("pointer-events", (d) => (isArcVisible(d.target, visibleRings) ? "auto" : "none"))
          .attr("tabindex", (d) => (isArcVisible(d.target, visibleRings) ? 0 : -1))
          // Set outside any d3 transition — the CSS rule above eases it,
          // in step with the geometry.
          .style("fill", fillFor);

        // Labels are joined over a second, much smaller subset. On a real
        // hierarchy this is a dozen <text> elements rather than one per
        // node — the single biggest saving here, since a <text> costs far
        // more than a <path> and almost none of them are ever readable.
        const labelData = inPlay.filter((d) => labelFor(d.current, d) !== null || labelFor(d.target, d) !== null);
        const joinedLabels = labelLayer.selectAll<SVGTextElement, AnimatedNode>("text").data(labelData, keyOfNode);
        const enteredLabels = joinedLabels
          .enter()
          .append("text")
          // White glyphs over a dark halo (stroke painted first, then
          // fill), and deliberately NOT theme tokens. Legacy picked black
          // or white per arc by averaging the fill's hex channels, which
          // can't work here — a fill may be a `var(--chart-N)` token JS
          // can't read a brightness from. The obvious substitute,
          // foreground-on-card, is worse than it looks: it assumes the
          // label sits on the page's surface, when it actually sits on a
          // saturated arc whose color owes nothing to the theme. In light
          // mode that put near-black text on a dark navy country and left
          // the halo doing all the work. Arc fills are always saturated
          // mid-tones now that depth is a tint rather than a fade, and
          // white-over-dark-outline is the standard map-label answer for
          // exactly that: legible on any hue, in either theme.
          .attr("fill", "#ffffff")
          .attr("stroke", "rgba(0, 0, 0, 0.55)")
          .attr("stroke-width", 2.5)
          .attr("stroke-linejoin", "round")
          .attr("paint-order", "stroke")
          .attr("transform", (d) => labelTransform(d.current, radius))
          // `opacity`, not the `fill-opacity` the Observable original
          // fades labels with: these labels carry that halo stroke, and
          // zeroing only the fill leaves it painting a white smear over
          // every arc too small to be labelled.
          .attr("opacity", (d) => (labelFor(d.current, d) === null ? 0 : 1));
        const allLabels = enteredLabels.merge(joinedLabels);
        paintLabels(allLabels, (d) => d.target);

        if (!animate) {
          arcs
            .attr("d", (d) => arc(d.target) ?? "")
            .attr("fill-opacity", (d) => (isArcVisible(d.target, visibleRings) ? 1 : 0));
          allLabels
            .attr("transform", (d) => labelTransform(d.target, radius))
            .attr("opacity", (d) => (labelFor(d.target, d) === null ? 0 : 1));
          joined.exit().remove();
          joinedLabels.exit().remove();
          return;
        }

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

        arcs
          .transition(t)
          // A hand-rolled lerp writing back into the node's existing
          // `current`, not `d3.interpolate`: the generic interpolator
          // allocates a fresh object per node per frame, which at 60fps
          // across a few hundred arcs is pure garbage-collector pressure
          // for the sake of four numbers.
          .tween("data", (d) => {
            const from = { ...d.current };
            const to = d.target;
            return (k: number) => {
              d.current.x0 = from.x0 + (to.x0 - from.x0) * k;
              d.current.x1 = from.x1 + (to.x1 - from.x1) * k;
              d.current.y0 = from.y0 + (to.y0 - from.y0) * k;
              d.current.y1 = from.y1 + (to.y1 - from.y1) * k;
            };
          })
          .attr("fill-opacity", (d) => (isArcVisible(d.target, visibleRings) ? 1 : 0))
          .attrTween("d", (d) => () => arc(d.current) ?? "");

        allLabels
          .transition(t)
          .attr("opacity", (d) => (labelFor(d.target, d) === null ? 0 : 1))
          .attrTween("transform", (d) => () => labelTransform(d.current, radius));

        // Settle once the tween lands: snap every node onto its target and
        // redraw without animating, which is what actually sheds the arcs
        // and labels that were only mounted for the animation's sake.
        // `.end()` rejects when another zoom interrupts this one — that
        // zoom does its own settling, so there is nothing to do here.
        t.end().then(
          () => {
            for (const node of nodes) copyBox(node.target, node.current);
            draw(false);
          },
          () => {},
        );
      }

      function zoomTo(target: AnimatedNode) {
        // A zero-width focus can't define a frame to map the tree into
        // (every arc would divide by zero); leave the view alone.
        if (!(target.x1 > target.x0)) return;

        focus = target;
        setFocusPath(keyPathOf(target));
        center.datum(target.parent ?? root);

        // Written in place, for the same reason the tween is: this runs
        // over every node in the tree on every zoom, and a fresh object
        // per node is thousands of allocations for four numbers.
        const span = target.x1 - target.x0;
        for (const node of nodes) {
          const box = node.target;
          box.x0 = Math.max(0, Math.min(1, (node.x0 - target.x0) / span)) * 2 * Math.PI;
          box.x1 = Math.max(0, Math.min(1, (node.x1 - target.x0) / span)) * 2 * Math.PI;
          box.y0 = Math.max(0, node.y0 - target.depth);
          box.y1 = Math.max(0, node.y1 - target.depth);
        }

        draw(true);
      }

      zoomToPathRef.current = (path) => {
        const target = findByKeyPath(root, path);
        if (target) zoomTo(target as AnimatedNode);
      };

      draw(false);

      return () => {
        zoomToPathRef.current = null;
      };
    },
    [layout, width, chartHeight, radius, visibleRings, resolveColor, readContainerRect],
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

  /** The swatch has to match the arc the pointer is actually over, tint
   * and all — the same ring-relative shading the fill uses, so the key in
   * the tooltip isn't a slightly different color from the thing it keys. */
  const hoveredSwatch = hovered
    ? depthFill(resolveColor(hovered.node), Math.max(0, hovered.node.depth - focusNode.depth - 1))
    : "";

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
        ref={containerRef}
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

        {hovered && hoveredNode ? (
          <ChartTooltip
            x={hovered.x}
            y={hovered.y}
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
                color: hoveredSwatch,
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
                color: hoveredSwatch,
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
