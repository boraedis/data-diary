"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover, MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { formatPercent, formatThousandsNumber } from "@/lib/viz/format";
import { pathId, type HierarchyDatum } from "@/lib/viz/hierarchy";
import { defaultColorOf, depthFill, findByKeyPath, keyPathOf } from "@/lib/viz/hierarchy-layout";
import {
  GROUP_HEADER_FONT_SIZE,
  GROUP_HEADER_HEIGHT,
  groupHeaderHeight,
  resolveHeaderLabel,
  resolveTileLabel,
  TILE_LABEL_PADDING,
} from "@/lib/viz/treemap";
import { cn } from "@/lib/utils";

// InteractiveTreemap (#213) — the proportional-area counterpart to
// InteractiveDonut, over the very same `HierarchyDatum` tree, so a page
// can build its tree once with `@/lib/viz/hierarchy`'s builders and hand it
// to either. A treemap and a sunburst are the same data in different
// geometry; they share colour and node identity through
// `@/lib/viz/hierarchy-layout` so they can't disagree about the tree.
//
// Depth — the decision #213 asked to have documented: **nested**, every
// level of the focused subtree on screen at once (capped by `maxDepth`
// when a caller wants less). One level is just a flat tree; nesting is
// where a treemap earns its keep, because it shows a part's share of its
// group and the group's share of the whole in a single picture. What
// nesting costs is the label problem #213 flagged, and three things
// contain it:
//  - a group gets a header band only when it's big enough to spend one
//    (`groupHeaderHeight`), so small groups don't lose their body to a
//    label nobody can read;
//  - tile labels follow the donut's fit-or-hide ladder
//    (`resolveTileLabel`), falling back to `shortName` before giving up;
//  - clicking any tile zooms into the group it belongs to, re-laying that
//    group out at full size — the treemap's answer to "that tile is too
//    small to read" is the same as the sunburst's: go closer.
//
// Animation is out of scope (#213 notes it as a future want). Two choices
// here keep it open rather than foreclosing it: the tiling is
// `d3.treemapResquarify`, which legacy's `people_treemap` also used for
// exactly this reason — once a layout exists it keeps each group's
// row/column orientation when values change, so a tile moves and resizes
// rather than jumping across the chart — and every rendered element is
// keyed by its node's full key path, so a later version can join old and
// new layouts and tween between them. Today a zoom rebuilds the SVG; with
// a few hundred rects that's cheap and reads as a cut.
//
// Not carried over from the donut: #166's right-click exclusion. It's a
// real feature there because a sunburst's small slices are otherwise
// unreachable; here the zoom already gets you to them, and nothing on the
// first consumer asked for it. Adding it later is the donut's pattern
// verbatim (`excludeByKeyPaths` is already shared).

/** Height reserved out of the caller's `height` for the breadcrumb row —
 * the donut's own budget, so the two primitives' chrome lines up. */
const BREADCRUMB_AREA_HEIGHT = 32;
/** Inset a group leaves around its children on the left, right and
 * bottom, so the group's wash shows as a frame. The top is the header
 * (`groupHeaderHeight`) or this same inset when there's no header. */
const GROUP_INSET = 3;
/** Surface gap between sibling tiles — the mark spec's "separate
 * neighbours with a gap, not a stroke". */
const TILE_GAP = MARK_SPECS.bar.surfaceGap;
/** Below this width or height (px) a tile isn't drawn: it would be a
 * hairline that can't be seen or hovered. Its value still counts toward
 * every ancestor, which is what sizes them. */
const MIN_TILE_SIZE = 0.5;
/** How strongly a group's own panel is tinted with its branch colour — a
 * wash behind its children, not a block (MARK_SPECS' area fill idea). */
const GROUP_WASH_PERCENT = 16;

type TreemapNode = d3.HierarchyRectangularNode<HierarchyDatum>;

export type InteractiveTreemapProps = {
  /** The tree to draw. Its own root is the initial focus and is never a
   * tile itself; its descendants are. Build it with
   * `@/lib/viz/hierarchy`'s helpers rather than by hand. */
  data: HierarchyDatum;
  width: number;
  height: number;
  /** How many levels below the focus are drawn. Omit for all of them.
   * Deeper levels aren't dropped — a group at the cutoff is drawn as one
   * tile carrying its whole subtree's value, and zooming into it reveals
   * the rest. */
  maxDepth?: number;
  /** Whether clicking a tile zooms into the group it belongs to. Hover
   * and the tooltip work either way. */
  zoomable?: boolean;
  formatValue?: (value: number) => string;
  /** Noun for the value in the tooltip, e.g. "days". */
  valueLabel?: string;
  /** Override the default branch-follows-the-palette fill. Gets the node
   * from the *whole* tree (not the zoomed subtree), so a branch keeps its
   * colour however far in you are. */
  color?: (node: d3.HierarchyNode<HierarchyDatum>) => string;
  ariaLabel?: string;
};

export function InteractiveTreemap({
  data,
  width,
  height,
  maxDepth,
  zoomable = true,
  formatValue = formatThousandsNumber,
  valueLabel = "total",
  color,
  ariaLabel = "Treemap. Each tile's area is its share of the total. Click a tile to zoom into its group; press Escape to zoom back out. Hover or focus a tile to see its value.",
}: InteractiveTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ path: string[]; x: number; y: number } | null>(null);

  // Which node is zoomed into, as a key path from the root. A `useD3`
  // dependency on purpose, unlike the donut's: a zoom here re-lays the
  // focused group out at full size and rebuilds the SVG, since there's no
  // tween to protect yet (see the header comment).
  const [focusPath, setFocusPath] = useState<string[]>([]);

  // New data invalidates the remembered focus and hover. Same
  // "adjust state when a prop changes" pattern as InteractiveDonut —
  // during render rather than in an effect, so the breadcrumb never
  // briefly names a path that no longer exists.
  const [renderedData, setRenderedData] = useState(data);
  if (renderedData !== data) {
    setRenderedData(data);
    setFocusPath([]);
    setHovered(null);
  }

  /** The whole tree, summed and ranked once. Colour and every number the
   * tooltip shows come from here, never from the zoomed layout: a branch's
   * palette slot is its rank among the *top-level* branches, and a share
   * "of Family" has to mean the same thing zoomed in or out. */
  const fullRoot = useMemo(
    () =>
      d3
        .hierarchy(data)
        .sum((d) => Math.max(0, d.value ?? 0))
        // Descending, so the biggest tile lands top-left and a branch's
        // palette slot is its rank, not the order the rows arrived in.
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [data],
  );
  const nodeByPath = useMemo(() => {
    const map = new Map<string, d3.HierarchyNode<HierarchyDatum>>();
    fullRoot.each((node) => map.set(pathId(keyPathOf(node)), node));
    return map;
  }, [fullRoot]);

  const resolveColor = useMemo(() => color ?? defaultColorOf, [color]);

  // A remembered focus whose node no longer exists (the tree changed
  // shape under it) falls back to the root rather than drawing nothing.
  const focusNode = findByKeyPath(fullRoot, focusPath) ?? fullRoot;
  const effectiveFocusPath = useMemo(() => keyPathOf(focusNode), [focusNode]);
  const chartHeight = Math.max(0, height - BREADCRUMB_AREA_HEIGHT);

  /** The focused subtree tiled to the full drawing area. A fresh
   * hierarchy over the focus's own data rather than a re-tile of the
   * full layout, so depth 0 is always the focus — `groupHeaderHeight`
   * and the tint ladder both read depth relative to what's on screen. */
  const layout = useMemo(() => {
    if (width <= 0 || chartHeight <= 0) return null;
    const root = d3
      .hierarchy(focusNode.data)
      .sum((d) => Math.max(0, d.value ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if ((root.value ?? 0) <= 0) return null;
    if (maxDepth !== undefined) {
      // After `.sum()`, so a node cut off here keeps its whole subtree's
      // value and is drawn as one tile of the right size.
      root.each((node) => {
        if (node.depth >= maxDepth) node.children = undefined;
      });
    }
    // Which groups got a header band, recorded as d3 decides it rather
    // than re-derived at draw time: `paddingTop` sees each group's box
    // *before* `.round(true)` snaps it, so re-running `groupHeaderHeight`
    // on the rounded box could disagree at the threshold and draw a
    // header over the group's own children.
    const headed = new Set<d3.HierarchyNode<HierarchyDatum>>();
    const tiled = d3
      .treemap<HierarchyDatum>()
      .tile(d3.treemapResquarify)
      .size([width, chartHeight])
      .paddingInner(TILE_GAP)
      .paddingTop((node) => {
        const header = groupHeaderHeight(node, node.depth);
        if (header > 0) headed.add(node);
        return node.depth === 0 ? 0 : header || GROUP_INSET;
      })
      .paddingRight((node) => (node.depth === 0 ? 0 : GROUP_INSET))
      .paddingBottom((node) => (node.depth === 0 ? 0 : GROUP_INSET))
      .paddingLeft((node) => (node.depth === 0 ? 0 : GROUP_INSET))
      .round(true)(root) as TreemapNode;
    return { root: tiled, headed };
  }, [focusNode, width, chartHeight, maxDepth]);

  /** Full key path of a layout node — the focus's own path plus the
   * node's path within the zoomed subtree. */
  const fullPathOf = useCallback(
    (node: d3.HierarchyNode<HierarchyDatum>) => [...effectiveFocusPath, ...keyPathOf(node)],
    [effectiveFocusPath],
  );

  const baseColorOf = useCallback(
    (node: d3.HierarchyNode<HierarchyDatum>) => {
      const full = nodeByPath.get(pathId(fullPathOf(node)));
      return full ? resolveColor(full) : "var(--muted-foreground)";
    },
    [nodeByPath, fullPathOf, resolveColor],
  );

  const zoomTo = useCallback((path: string[]) => {
    setHovered(null);
    setFocusPath(path);
  }, []);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", chartHeight).attr("viewBox", [0, 0, width, chartHeight].join(" "));
      if (!layout) return;

      const drawn = layout.root
        .descendants()
        .slice(1)
        .filter((d) => d.x1 - d.x0 >= MIN_TILE_SIZE && d.y1 - d.y0 >= MIN_TILE_SIZE);
      const keyOf = (d: TreemapNode) => pathId(fullPathOf(d));

      /** The group a click on `d` zooms into: its ancestor one level
       * below the focus, when that ancestor has anything inside it.
       * Checked against `data.children` rather than the layout's, so a
       * group `maxDepth` drew as a single tile still zooms. */
      function zoomTargetOf(d: TreemapNode): string[] | null {
        const top = d.ancestors().find((a) => a.depth === 1);
        return top && (top.data.children?.length ?? 0) > 0 ? fullPathOf(top) : null;
      }

      const onHover = (d: TreemapNode, clientPos: { x: number; y: number }) => {
        const rect = containerRef.current?.getBoundingClientRect();
        setHovered({ path: fullPathOf(d), x: clientPos.x - (rect?.left ?? 0), y: clientPos.y - (rect?.top ?? 0) });
      };
      const onLeave = () => setHovered(null);

      // Groups first, so their children paint on top of the wash.
      // Pre-order from `descendants()` already puts every parent before
      // its children, which is exactly the paint order nesting needs.
      const tiles = svg
        .append("g")
        .selectAll<SVGGElement, TreemapNode>("g")
        .data(drawn, keyOf)
        .join("g")
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

      const rects = tiles
        .append("rect")
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => d.y1 - d.y0)
        .attr("rx", 2)
        .attr("fill", (d) => {
          const base = baseColorOf(d);
          // A group is a tinted panel its children sit on; a tile is the
          // branch colour, lightened one step per level below the first
          // (the donut's ring ladder, read as nesting depth).
          return d.children
            ? `color-mix(in oklch, ${base} ${GROUP_WASH_PERCENT}%, transparent)`
            : depthFill(base, d.depth - 1);
        });

      attachMarkHover<TreemapNode>(rects as unknown as d3.Selection<d3.BaseType, TreemapNode, d3.BaseType, unknown>, {
        onHover,
        onLeave,
      });

      rects
        // Only promise a click where one does something.
        .style("cursor", (d) => (zoomable && zoomTargetOf(d) ? "pointer" : "default"))
        .attr("aria-label", (d) => `${d.data.name}: ${formatValue(d.value ?? 0)} ${valueLabel}`)
        .on("click", (_event, d) => {
          if (!zoomable) return;
          const target = zoomTargetOf(d);
          if (target) zoomTo(target);
        })
        .on("keydown", (event: KeyboardEvent, d) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const target = zoomable ? zoomTargetOf(d) : null;
            if (target) zoomTo(target);
          } else if (event.key === "Escape" || event.key === "Backspace") {
            event.preventDefault();
            if (effectiveFocusPath.length > 0) zoomTo(effectiveFocusPath.slice(0, -1));
          }
        });

      // Labels never take the pointer — the rect under them is the target.
      const text = tiles.append("g").attr("pointer-events", "none").style("user-select", "none");

      // Group headers: foreground-on-surface text, since the header band
      // sits on the group's pale wash rather than on a saturated fill.
      text
        .filter((d) => layout.headed.has(d))
        .each(function (d) {
          const label = resolveHeaderLabel(d.x1 - d.x0, d.data.name, d.data.shortName);
          if (!label) return;
          d3.select(this)
            .append("text")
            .attr("x", TILE_LABEL_PADDING)
            .attr("y", GROUP_HEADER_HEIGHT / 2)
            .attr("dy", "0.35em")
            .attr("fill", "var(--foreground)")
            .style("font-size", `${GROUP_HEADER_FONT_SIZE}px`)
            .style("font-weight", 500)
            .text(label);
        });

      // Leaf tiles: white over a dark halo, the donut's answer for text
      // on a fill whose colour owes nothing to the theme (a user-chosen
      // tag colour, or a `var(--chart-N)` token JS can't read a
      // brightness from). Legible on any hue, in either theme.
      text
        .filter((d) => !d.children)
        .each(function (d) {
          const label = resolveTileLabel(d, d.data.name, d.data.shortName, formatValue(d.value ?? 0));
          if (!label) return;
          const lines = label.value !== undefined ? [...label.lines, label.value] : label.lines;
          d3.select(this)
            .append("text")
            .attr("fill", "#ffffff")
            .attr("stroke", "rgba(0, 0, 0, 0.55)")
            .attr("stroke-width", 2.5)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("font-size", `${label.size}px`)
            .selectAll("tspan")
            .data(lines)
            .join("tspan")
            .attr("x", TILE_LABEL_PADDING)
            // Top-left anchored, the treemap convention: a reader scans
            // tiles like text, and a label pinned to the corner stays put
            // however the tile's aspect ratio comes out.
            .attr("y", (_line, i) => TILE_LABEL_PADDING + label.size * (1.2 * i + 0.95))
            // The value line reads as secondary without shrinking it.
            .attr("opacity", (_line, i) => (label.value !== undefined && i === lines.length - 1 ? 0.85 : 1))
            .text((line) => line);
        });
    },
    [layout, width, chartHeight, fullPathOf, baseColorOf, zoomable, zoomTo, formatValue, valueLabel, effectiveFocusPath],
  );

  const trail = focusNode.ancestors().reverse();
  const hoveredNode = hovered ? nodeByPath.get(pathId(hovered.path)) : undefined;
  const grandTotal = fullRoot.value ?? 0;

  const tooltipRows = useMemo<TooltipRow[]>(() => {
    if (!hoveredNode) return [];
    const base = resolveColor(hoveredNode);
    const swatch = hoveredNode.children ? base : depthFill(base, hoveredNode.depth - focusNode.depth - 1);
    const value = hoveredNode.value ?? 0;
    const parent = hoveredNode.parent;
    const rows: TooltipRow[] = [
      { label: valueLabel, value: formatValue(value), color: swatch, variant: "swatch" },
    ];
    if (parent) {
      // Share of the group first — "8% of Family" is the proportion the
      // nesting is drawn to show; the share of everything follows when
      // that's a different number.
      rows.push({
        label: `of ${parent.data.name}`,
        value: formatPercent((parent.value ?? 0) > 0 ? value / (parent.value ?? 1) : 0, 1),
        color: swatch,
        noSwatch: true,
      });
      if (parent !== fullRoot) {
        rows.push({
          label: `of ${fullRoot.data.name}`,
          value: formatPercent(grandTotal > 0 ? value / grandTotal : 0, 1),
          color: swatch,
          noSwatch: true,
        });
      }
    }
    return rows;
  }, [hoveredNode, resolveColor, focusNode, valueLabel, formatValue, fullRoot, grandTotal]);

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
              // The last crumb is where you already are.
              disabled={i === trail.length - 1}
              onClick={() => zoomTo(keyPathOf(node))}
              className={cn(
                "rounded px-1 py-0.5",
                i === trail.length - 1 ? "font-medium text-foreground" : "hover:bg-accent hover:text-foreground",
              )}
            >
              {node.data.name}
            </button>
          </span>
        ))}
        {/* The focus's total, where the donut puts it in its center hole
            — a treemap has no center, and the breadcrumb is the one place
            that always names what's on screen. A live region, so a zoom
            announces where it landed. */}
        <span role="status" aria-live="polite" className="ml-2 shrink-0 tabular-nums">
          {formatValue(focusNode.value ?? 0)} {valueLabel}
          {focusNode.parent ? ` · ${formatPercent(grandTotal > 0 ? (focusNode.value ?? 0) / grandTotal : 0, 1)} of ${fullRoot.data.name}` : null}
        </span>
      </nav>

      <div
        ref={containerRef}
        style={{ position: "relative", width, height: chartHeight }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg ref={ref} />
        {hovered && hoveredNode ? (
          <ChartTooltip
            x={hovered.x}
            y={hovered.y}
            // Full ancestry: zoomed out, "Alex" alone doesn't say which
            // group's tile you're on.
            title={hoveredNode
              .ancestors()
              .reverse()
              .slice(1)
              .map((n) => n.data.name)
              .join(" / ")}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
    </div>
  );
}
