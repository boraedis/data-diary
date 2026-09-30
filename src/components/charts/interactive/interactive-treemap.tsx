"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
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
// Animation (added on #213's own PR, for the people time-lapse): every
// change to `data` tweens, rather than cutting. Two pieces make that work,
// and both are why this primitive does NOT use `useD3` — that hook clears
// and rebuilds the `<svg>` on every dependency change, which is precisely
// the thing an animated treemap can't have:
//  - **A persistent layout.** `d3.treemapResquarify` remembers each
//    group's rows on the hierarchy's own node objects (`_squarify`), and
//    only reuses them if the *same* nodes are laid out again. So while the
//    tree keeps its shape (same key paths — a time-lapse frame, a resize),
//    the existing nodes are re-valued in place and re-tiled: tiles grow and
//    shrink within a fixed arrangement instead of shuffling around the
//    chart as ranks change. Legacy's `people_treemap` picked resquarify for
//    the same reason. A change of shape (a zoom, a different grouping)
//    builds a fresh layout.
//  - **A keyed join.** Every tile is keyed by its node's full key path, so
//    the same person is the same `<g>` before and after, and d3 tweens its
//    position and size. That covers zoom for free: zooming into a group
//    slides its tiles out to fill the chart while the rest fade.
//
// `layoutSeed` exists because resquarify's rows are only as good as the
// values they were first computed from: seeded from a time-lapse's first,
// nearly-empty month, every later month is squeezed into rows shaped for
// three people. The caller hands a seed that gives every tile room — the
// end state, for a running count — so the arrangement reads well where
// the animation stops, and earlier frames are that same arrangement,
// smaller.
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
/** Default tween length for a zoom or a data change. */
export const TREEMAP_TRANSITION_MS = 450;

type TreemapNode = d3.HierarchyRectangularNode<HierarchyDatum>;

const ROOT_PATH: string[] = [];

/** The layout that survives between renders — see the header comment. */
type LayoutCache = {
  /** Identity of the tree's *shape*: the focus plus every key path under
   * it, and the depth cap. Values aren't part of it; a change of values
   * alone re-tiles these same nodes. */
  shape: string;
  /** The seed the arrangement was built from. A new seed (the caller
   * switched what the tiles measure) re-arranges from scratch, even when
   * the shape is unchanged — otherwise the tiles would stay in rows
   * decided by a metric no longer on screen. */
  seed: HierarchyDatum | undefined;
  root: TreemapNode;
  width: number;
  height: number;
};

/** A node's own value plus everything under it, floored at zero — what a
 * tile is sized by. Used instead of d3's `.sum()` because `maxDepth`
 * detaches children from the layout's nodes, and a cut-off group must
 * still carry its whole subtree. */
function subtreeTotal(datum: HierarchyDatum): number {
  return Math.max(0, datum.value ?? 0) + (datum.children ?? []).reduce((total, child) => total + subtreeTotal(child), 0);
}

/** The datum at `path` under `root`, or `null`. */
function datumAt(root: HierarchyDatum, path: string[]): HierarchyDatum | null {
  let node: HierarchyDatum | undefined = root;
  for (const key of path) {
    node = node?.children?.find((child) => child.key === key);
    if (!node) return null;
  }
  return node;
}

/** Every key path in `datum`'s subtree down to `maxDepth`, keyed for
 * lookup — the shape signature and the in-place re-valuing both use it. */
function indexByPath(datum: HierarchyDatum, maxDepth: number | undefined): Map<string, HierarchyDatum> {
  const index = new Map<string, HierarchyDatum>();
  const walk = (node: HierarchyDatum, path: string[]) => {
    index.set(pathId(path), node);
    if (maxDepth !== undefined && path.length >= maxDepth) return;
    for (const child of node.children ?? []) walk(child, [...path, child.key]);
  };
  walk(datum, []);
  return index;
}

/** Recomputes every node's `value` from its (possibly just swapped) data,
 * bottom-up — what `.sum()` does, written out because `.sum()` can't see a
 * cut-off group's detached subtree. d3 types `value` as read-only since
 * `.sum()`/`.count()` are its only intended writers; this is a third. */
function revalue(root: d3.HierarchyNode<HierarchyDatum>): void {
  root.eachAfter((node) => {
    (node as { value?: number }).value = node.children
      ? Math.max(0, node.data.value ?? 0) + node.children.reduce((total, child) => total + (child.value ?? 0), 0)
      : subtreeTotal(node.data);
  });
}

export type InteractiveTreemapProps = {
  /** The tree to draw. Its own root is the initial focus and is never a
   * tile itself; its descendants are. Build it with
   * `@/lib/viz/hierarchy`'s helpers rather than by hand. A new tree with
   * the same key paths (a time-lapse frame) animates in place. */
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
  /**
   * A tree with the same key paths as `data` whose values decide the
   * tiles' *arrangement* — which rows they sit in, and in what order —
   * while `data` decides their sizes. For a time-lapse, pass the last
   * frame, or whatever gives every tile room in proportion to its peak.
   * It also fixes the palette rank of any branch without its own colour,
   * so an uncoloured branch can't change colour as frames play. Pass a
   * stable (memoised) object: a new seed re-arranges the tiles. Ignored
   * where its shape doesn't match `data`'s. See the header comment.
   */
  layoutSeed?: HierarchyDatum;
  /** Tween length in ms for a change of data or zoom; 0 snaps. A caller
   * playing frames should pass its frame interval, so each tween ends as
   * the next frame arrives and the motion reads as continuous. */
  transitionMs?: number;
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
  layoutSeed,
  transitionMs = TREEMAP_TRANSITION_MS,
  formatValue = formatThousandsNumber,
  valueLabel = "total",
  color,
  ariaLabel = "Treemap. Each tile's area is its share of the total. Click a tile to zoom into its group; press Escape to zoom back out. Hover or focus a tile to see its value.",
}: InteractiveTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cacheRef = useRef<LayoutCache | null>(null);
  const [hovered, setHovered] = useState<{ path: string[]; x: number; y: number } | null>(null);

  // Which node is zoomed into, as a key path from the root. Kept across a
  // change of `data` on purpose: a time-lapse frame is a new tree with the
  // same paths, and zooming into a group shouldn't be undone by the next
  // month. A path that no longer exists falls back to the root below.
  const [focusPath, setFocusPath] = useState<string[]>([]);

  /** The whole tree, summed and ranked. Every number the tooltip and
   * breadcrumb show comes from here, never from the zoomed layout, so a
   * share "of Family" means the same thing zoomed in or out. */
  const fullRoot = useMemo(
    () =>
      d3
        .hierarchy(data)
        .sum((d) => Math.max(0, d.value ?? 0))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [data],
  );
  const nodeByPath = useMemo(() => {
    const map = new Map<string, d3.HierarchyNode<HierarchyDatum>>();
    fullRoot.each((node) => map.set(pathId(keyPathOf(node)), node));
    return map;
  }, [fullRoot]);

  /** Colour is ranked over the seed when there is one — see
   * `layoutSeed` — so a frame reordering two uncoloured branches doesn't
   * swap their colours mid-animation. */
  const colorRoot = useMemo(
    () =>
      layoutSeed
        ? d3
            .hierarchy(layoutSeed)
            .sum((d) => Math.max(0, d.value ?? 0))
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        : fullRoot,
    [layoutSeed, fullRoot],
  );
  const resolveColor = useMemo(() => color ?? defaultColorOf, [color]);
  const baseColorByPath = useMemo(() => {
    const map = new Map<string, string>();
    colorRoot.each((node) => map.set(pathId(keyPathOf(node)), resolveColor(node)));
    return map;
  }, [colorRoot, resolveColor]);
  const baseColorAt = useCallback(
    (path: string[]) => baseColorByPath.get(pathId(path)) ?? "var(--muted-foreground)",
    [baseColorByPath],
  );

  // A remembered focus whose node no longer exists (the tree changed
  // shape under it) falls back to the root rather than drawing nothing.
  const focusFound = findByKeyPath(fullRoot, focusPath);
  const focusNode = focusFound ?? fullRoot;
  // The state array itself (not a path re-derived from `focusNode`, which
  // is a new object every frame), so the draw effect only sees a new
  // focus when the focus actually changed.
  const effectiveFocusPath = focusFound ? focusPath : ROOT_PATH;
  const focusKey = pathId(effectiveFocusPath);
  const chartHeight = Math.max(0, height - BREADCRUMB_AREA_HEIGHT);

  const zoomTo = useCallback((path: string[]) => {
    setHovered(null);
    setFocusPath(path);
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3
      .select(svgEl)
      .attr("width", width)
      .attr("height", chartHeight)
      .attr("viewBox", [0, 0, width, chartHeight].join(" "));
    const layer = svg
      .selectAll<SVGGElement, null>("g.tiles")
      .data([null])
      .join("g")
      .attr("class", "tiles");

    const focusDatum = datumAt(data, effectiveFocusPath) ?? data;
    const index = indexByPath(focusDatum, maxDepth);
    const shape = `${focusKey}|${maxDepth ?? ""}|${[...index.keys()].sort().join("\u0001")}`;
    const cache = cacheRef.current;

    if (width <= 0 || chartHeight <= 0 || subtreeTotal(focusDatum) <= 0) {
      layer.selectAll("g.tile").remove();
      cacheRef.current = null;
      return;
    }

    // Which groups got a header band, recorded as d3 decides it rather
    // than re-derived at draw time: `paddingTop` sees each group's box
    // *before* `.round(true)` snaps it, so re-running `groupHeaderHeight`
    // on the rounded box could disagree at the threshold and draw a
    // header over the group's own children.
    const headed = new Set<d3.HierarchyNode<HierarchyDatum>>();
    const tile = (root: d3.HierarchyNode<HierarchyDatum>) => {
      headed.clear();
      return d3
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
    };

    const inPlace = cache !== null && cache.shape === shape && cache.seed === layoutSeed;
    let root: TreemapNode;
    if (inPlace) {
      // Same shape: swap the new data onto the existing nodes and re-tile
      // them, so resquarify reuses its rows.
      root = cache.root;
      root.each((node) => {
        node.data = index.get(pathId(keyPathOf(node))) ?? node.data;
      });
      revalue(root);
      tile(root);
    } else {
      // New shape: lay out from the seed first when it has the same
      // shape, so the rows resquarify remembers are the seed's; then
      // re-value with the real data (a second, in-place tiling).
      const seedDatum = layoutSeed ? datumAt(layoutSeed, effectiveFocusPath) : null;
      const seedIndex = seedDatum ? indexByPath(seedDatum, maxDepth) : null;
      const seedMatches =
        seedIndex !== null && seedIndex.size === index.size && [...index.keys()].every((key) => seedIndex.has(key));
      const fresh = d3.hierarchy(seedMatches ? seedDatum! : focusDatum);
      if (maxDepth !== undefined) {
        fresh.each((node) => {
          if (node.depth >= maxDepth) node.children = undefined;
        });
      }
      revalue(fresh);
      // Descending, so the biggest tile lands top-left. Only ever sorted
      // here — re-sorting an in-place update would reorder the rows
      // resquarify is holding on to.
      fresh.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      root = tile(fresh);
      if (seedMatches) {
        root.each((node) => {
          node.data = index.get(pathId(keyPathOf(node))) ?? node.data;
        });
        revalue(root);
        tile(root);
      }
    }

    // Snap rather than tween on the first draw and on a resize — a resize
    // tween reads as the chart wobbling, not as anything happening.
    const animate = transitionMs > 0 && cache !== null && cache.width === width && cache.height === chartHeight;
    cacheRef.current = { shape, seed: layoutSeed, root, width, height: chartHeight };

    const fullPathOf = (node: d3.HierarchyNode<HierarchyDatum>) => [...effectiveFocusPath, ...keyPathOf(node)];
    const keyOf = (d: TreemapNode) => pathId(fullPathOf(d));
    const drawn = root
      .descendants()
      .slice(1)
      .filter((d) => d.x1 - d.x0 >= MIN_TILE_SIZE && d.y1 - d.y0 >= MIN_TILE_SIZE);

    /** The group a click on `d` zooms into: its ancestor one level below
     * the focus, when that ancestor has anything inside it. Checked
     * against `data.children` rather than the layout's, so a group
     * `maxDepth` drew as a single tile still zooms. */
    function zoomTargetOf(d: TreemapNode): string[] | null {
      const top = d.ancestors().find((a) => a.depth === 1);
      return top && (top.data.children?.length ?? 0) > 0 ? fullPathOf(top) : null;
    }

    // A value change (a time-lapse frame) eases linearly, so a run of
    // frames reads as one continuous growth rather than a pulse per
    // frame; a zoom or regrouping is one discrete move and eases in and
    // out.
    const t = svg
      .transition()
      .duration(animate ? transitionMs : 0)
      .ease(inPlace ? d3.easeLinear : d3.easeCubicInOut) as unknown as d3.Transition<
      d3.BaseType,
      unknown,
      d3.BaseType,
      unknown
    >;

    const tiles = layer
      .selectAll<SVGGElement, TreemapNode>("g.tile")
      .data(drawn, keyOf)
      .join(
        (enter) => {
          const g = enter
            .append("g")
            .attr("class", "tile")
            .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
            .attr("opacity", animate ? 0 : 1);
          g.append("rect")
            .attr("rx", 2)
            .attr("width", (d) => d.x1 - d.x0)
            .attr("height", (d) => d.y1 - d.y0);
          g.append("g").attr("class", "label").attr("pointer-events", "none").style("user-select", "none");
          return g;
        },
        (update) => update,
        (exit) => {
          if (animate) exit.transition(t).attr("opacity", 0).remove();
          else exit.remove();
        },
      );
    // Parents before children, which is the paint order nesting needs —
    // an entering group would otherwise be appended after (on top of) its
    // own already-present children.
    tiles.order();

    const rects = tiles.select<SVGRectElement>("rect");
    if (animate) {
      // `opacity` is in here too: an element caught mid-exit by the next
      // frame (a tile that's shrinking to nothing as you scrub backwards,
      // then grows again) is matched by key, its exit tween interrupted,
      // and brought back.
      tiles
        .transition(t)
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
        .attr("opacity", 1);
      rects
        .transition(t)
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => d.y1 - d.y0);
    } else {
      tiles.interrupt().attr("transform", (d) => `translate(${d.x0},${d.y0})`).attr("opacity", 1);
      rects
        .interrupt()
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => d.y1 - d.y0);
    }

    rects.attr("fill", (d) => {
      const base = baseColorAt(fullPathOf(d));
      // A group is a tinted panel its children sit on; a tile is the
      // branch colour, lightened one step per level below the first (the
      // donut's ring ladder, read as nesting depth).
      return d.children
        ? `color-mix(in oklch, ${base} ${GROUP_WASH_PERCENT}%, transparent)`
        : depthFill(base, d.depth - 1);
    });

    // Re-bound on every draw, not just on enter: a tile that survives a
    // zoom is the same element, but its path (and so what hovering or
    // clicking it means) changed.
    attachMarkHover<TreemapNode>(rects as unknown as d3.Selection<d3.BaseType, TreemapNode, d3.BaseType, unknown>, {
      onHover: (d, clientPos) => {
        const rect = containerRef.current?.getBoundingClientRect();
        setHovered({ path: fullPathOf(d), x: clientPos.x - (rect?.left ?? 0), y: clientPos.y - (rect?.top ?? 0) });
      },
      onLeave: () => setHovered(null),
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

    // Labels are rewritten for each tile's *destination* box. They ride
    // along with the tile's own translate, so during a tween a label can
    // briefly sit in a tile still growing into it — a quarter-second
    // overlap, against the alternative of re-fitting text every frame.
    tiles.select<SVGGElement>("g.label").each(function (d) {
      const group = d3.select(this);
      group.selectAll("*").remove();
      if (headed.has(d)) {
        // Foreground-on-surface text: the header band sits on the group's
        // pale wash rather than on a saturated fill.
        const label = resolveHeaderLabel(d.x1 - d.x0, d.data.name, d.data.shortName);
        if (label) {
          group
            .append("text")
            .attr("x", TILE_LABEL_PADDING)
            .attr("y", GROUP_HEADER_HEIGHT / 2)
            .attr("dy", "0.35em")
            .attr("fill", "var(--foreground)")
            .style("font-size", `${GROUP_HEADER_FONT_SIZE}px`)
            .style("font-weight", 500)
            .text(label);
        }
        return;
      }
      if (d.children) return;
      const label = resolveTileLabel(d, d.data.name, d.data.shortName, formatValue(d.value ?? 0));
      if (!label) return;
      const lines = label.value !== undefined ? [...label.lines, label.value] : label.lines;
      // White over a dark halo, the donut's answer for text on a fill
      // whose colour owes nothing to the theme (a user-chosen tag colour,
      // or a `var(--chart-N)` token JS can't read a brightness from).
      group
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
        // Top-left anchored, the treemap convention: a reader scans tiles
        // like text, and a label pinned to the corner stays put however
        // the tile's aspect ratio comes out.
        .attr("y", (_line, i) => TILE_LABEL_PADDING + label.size * (1.2 * i + 0.95))
        // The value line reads as secondary without shrinking it.
        .attr("opacity", (_line, i) => (label.value !== undefined && i === lines.length - 1 ? 0.85 : 1))
        .text((line) => line);
    });
  }, [
    data,
    layoutSeed,
    width,
    chartHeight,
    maxDepth,
    focusKey,
    effectiveFocusPath,
    baseColorAt,
    zoomable,
    zoomTo,
    transitionMs,
    formatValue,
    valueLabel,
  ]);

  const trail = focusNode.ancestors().reverse();
  const hoveredNode = hovered ? nodeByPath.get(pathId(hovered.path)) : undefined;
  const grandTotal = fullRoot.value ?? 0;

  const tooltipRows = useMemo<TooltipRow[]>(() => {
    if (!hoveredNode) return [];
    const base = baseColorAt(keyPathOf(hoveredNode));
    const swatch = hoveredNode.children ? base : depthFill(base, hoveredNode.depth - focusNode.depth - 1);
    const value = hoveredNode.value ?? 0;
    const parent = hoveredNode.parent;
    const rows: TooltipRow[] = [{ label: valueLabel, value: formatValue(value), color: swatch, variant: "swatch" }];
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
  }, [hoveredNode, baseColorAt, focusNode, valueLabel, formatValue, fullRoot, grandTotal]);

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
            that always names what's on screen. Not a live region: during a
            time-lapse it changes every frame, and the caller owns
            announcing where playback settled. */}
        <span className="ml-2 shrink-0 tabular-nums">
          {formatValue(focusNode.value ?? 0)} {valueLabel}
          {focusNode.parent
            ? ` · ${formatPercent(grandTotal > 0 ? (focusNode.value ?? 0) / grandTotal : 0, 1)} of ${fullRoot.data.name}`
            : null}
        </span>
      </nav>

      <div
        ref={containerRef}
        style={{ position: "relative", width, height: chartHeight }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg ref={svgRef} />
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
