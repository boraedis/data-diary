"use client";

import { useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover } from "./marks";
import { ChartTooltip } from "./tooltip";
import { categoricalColor } from "@/lib/viz/color";

// InteractiveNetwork (#23) — the shared force-directed graph primitive.
// Generalizes PeopleNetworkChart (already close to this shape: force
// simulation run to convergence once rather than a live physics loop,
// drag-to-reposition as the one interactive affordance) into a reusable
// component with generic {nodes, edges} input instead of a people-specific
// one-off. See that component's own comment for why a static layout was
// chosen over legacy's live `setInterval` re-tick loop — that choice
// carries over unchanged here, just generalized.

// Module-level, not inline default parameter values: a `= [3, 16]`-style
// default is a fresh array literal on *every* render, and since these feed
// useD3's deps array below, that would rebuild the whole <svg> on every
// render of this component — including one triggered by its own `hovered`
// state, which attachMarkHover updates on every pointermove over a node,
// not just on enter. That combination (unstable dep + a hover-driven
// re-render) was silently tearing down and rebuilding the graph on nearly
// every mouse movement over a node, orphaning any in-progress drag or
// click mid-gesture — the real cause behind drag/click never working, not
// just the event-target bug fixed alongside this.
const DEFAULT_RADIUS_RANGE: [number, number] = [3, 16];
const DEFAULT_STROKE_RANGE: [number, number] = [0.5, 3];
const DEFAULT_ZOOM_EXTENT: [number, number] = [0.3, 8];

type SimNode = NetworkNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { weight: number };

function asNode(v: SimLink["source"]): SimNode {
  // Safe once the simulation has ticked: d3.forceLink replaces the raw
  // source/target ids with references to the actual node objects on its
  // first tick.
  return v as SimNode;
}

export type NetworkNode = { id: string | number; label: string; count: number };
export type NetworkEdge = { source: string | number; target: string | number; weight: number };

type Hovered = { node: NetworkNode; clientPos: { x: number; y: number } };

export type InteractiveNetworkProps = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  width: number;
  height: number;
  /** Node fill — a single color (defaults to `categoricalColor(0)`, so it
   * still tracks light/dark mode) or a function keying color off the node
   * itself (e.g. a per-person tag color) when nodes aren't one
   * undifferentiated series. */
  color?: string | ((node: NetworkNode) => string);
  /** `d3.scaleSqrt` range, px — node radius by count. */
  radiusRange?: [number, number];
  /** `d3.scaleLinear` range, px — edge stroke width by weight. */
  strokeRange?: [number, number];
  /** Edges below this weight aren't drawn or simulated at all — the
   * "minimum bar" for two nodes to be considered connected. Defaults to 1
   * (every real co-occurrence draws an edge); raise it to declutter a
   * dense graph down to only its stronger connections. Filtered before
   * the simulation runs, not just at render time, so a pruned edge also
   * stops pulling its two nodes together. */
  minEdgeWeight?: number;
  /** `d3.zoom` scale extent — how far a viewer can scroll-zoom in/out.
   * Defaults to a wide range since node/label legibility at the zoomed-out
   * end matters more here than on an axis-based chart. */
  zoomExtent?: [number, number];
  /** Label for the tooltip's count row, given the hovered node's count —
   * e.g. `(n) => `day${n === 1 ? "" : "s"}`` for a per-day co-occurrence
   * count. Defaults to the generic "count". */
  countLabel?: (count: number) => string;
  ariaLabel?: string;
};

export function InteractiveNetwork({
  nodes,
  edges: allEdges,
  width,
  height,
  color = categoricalColor(0),
  radiusRange = DEFAULT_RADIUS_RANGE,
  strokeRange = DEFAULT_STROKE_RANGE,
  minEdgeWeight = 1,
  zoomExtent = DEFAULT_ZOOM_EXTENT,
  countLabel = () => "count",
  ariaLabel = "Force-directed network graph. Scroll or pinch to zoom, drag the background to pan. Click a node to highlight its edges, drag a node to reposition it.",
}: InteractiveNetworkProps) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // A state-backed callback ref, not a plain useRef — see interactive-hist's
  // own comment on why this needs to be state, not a ref read during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const resolveColor = (n: NetworkNode) => (typeof color === "function" ? color(n) : color);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (nodes.length === 0) return;

      const edges = allEdges.filter((e) => e.weight >= minEdgeWeight);

      const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
      const simLinks: SimLink[] = edges.map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      }));

      const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(nodes, (n) => n.count) ?? 1])
        .range(radiusRange);
      const strokeScale = d3
        .scaleLinear()
        .domain([0, d3.max(edges, (e) => e.weight) ?? 1])
        .range(strokeRange);

      // Run to convergence synchronously rather than animating — see the
      // module comment above.
      const simulation = d3
        .forceSimulation(simNodes)
        .force(
          "link",
          d3
            .forceLink<SimNode, SimLink>(simLinks)
            .id((d) => d.id)
            .distance(46)
            .strength(0.15),
        )
        .force("charge", d3.forceManyBody().strength(-70))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force(
          "collide",
          d3.forceCollide<SimNode>().radius((d) => radiusScale(d.count) + 5),
        )
        .stop();

      for (let i = 0; i < 300; i++) simulation.tick();

      const g = svg.attr("width", width).attr("height", height).append("g");

      const link = g
        .append("g")
        .selectAll("line")
        .data(simLinks)
        .join("line")
        .attr("x1", (d) => asNode(d.source).x ?? 0)
        .attr("y1", (d) => asNode(d.source).y ?? 0)
        .attr("x2", (d) => asNode(d.target).x ?? 0)
        .attr("y2", (d) => asNode(d.target).y ?? 0)
        .attr("stroke", "var(--border)")
        .attr("stroke-width", (d) => strokeScale(d.weight));

      // Click-to-highlight (declared before the drag behavior below, which
      // reads/writes both): selecting a node highlights only its immediate
      // edges (and dims the rest), rather than a full-node subgraph walk —
      // matches the "immediate edges" scope, not a connected-component
      // explorer. Selection state lives as a plain closure variable, not
      // React state, for the same reason drag position does: useD3 fully
      // rebuilds the <svg> on every dependency change (see this hook's own
      // doc comment), so anything that should update *without* a rebuild —
      // a click, same as a pointermove — has to be applied by directly
      // mutating the DOM here instead.
      let selectedId: SimNode["id"] | null = null;

      const node = g
        .append("g")
        .selectAll<SVGGElement, SimNode>("g")
        .data(simNodes)
        .join("g")
        .attr("transform", (d) => `translate(${d.x},${d.y})`)
        .style("cursor", "grab")
        .call(
          d3
            .drag<SVGGElement, SimNode>()
            .on("start", (event, d) => {
              // Keeps the drag gesture from also panning the zoom behavior
              // below — both listen on/under the same <svg>, and a
              // mousedown/pointerdown on a node otherwise bubbles up to
              // zoom's own listener on `svg`.
              event.sourceEvent.stopPropagation();
              d.fx = d.x;
              d.fy = d.y;
            })
            .on("drag", function (event, d) {
              d.fx = event.x;
              d.fy = event.y;
              // `this` (a regular function, not an arrow function) is the
              // dragged <g> itself, per d3's own per-datum invocation
              // context — unlike `event.sourceEvent.currentTarget`, which
              // once dragging is underway points at whatever element the
              // native pointermove/mousemove actually landed on (usually
              // the document, since drag tracks the pointer outside the
              // node's own bounds), not the node being dragged.
              d3.select(this).attr("transform", `translate(${event.x},${event.y})`);
              link
                .attr("x1", (l) => asNode(l.source).x ?? 0)
                .attr("y1", (l) => asNode(l.source).y ?? 0)
                .attr("x2", (l) => asNode(l.target).x ?? 0)
                .attr("y2", (l) => asNode(l.target).y ?? 0);
            }),
        );

      const circle = node
        .append("circle")
        .attr("r", (d) => radiusScale(d.count))
        .attr("fill", (d) => resolveColor(d))
        .attr("fill-opacity", 0.85);

      node
        .append("text")
        .attr("x", (d) => radiusScale(d.count) + 3)
        .attr("y", 3)
        .attr("fill", "var(--foreground)")
        .style("font-size", "10px")
        .style("pointer-events", "none")
        .text((d) => d.label);

      function isIncident(l: SimLink): boolean {
        return selectedId !== null && (asNode(l.source).id === selectedId || asNode(l.target).id === selectedId);
      }

      function applySelection() {
        link
          .attr("stroke", (l) => (isIncident(l) ? "var(--foreground)" : "var(--border)"))
          .attr("stroke-opacity", (l) => (selectedId === null || isIncident(l) ? 1 : 0.25));
        circle
          .attr("stroke", (d) => (d.id === selectedId ? "var(--foreground)" : null))
          .attr("stroke-width", (d) => (d.id === selectedId ? 2 : null));
      }

      // A plain "click" listener works here — unlike a naive "did the
      // drag move" check might suggest, d3-drag only suppresses the
      // native click that follows a gesture when real pointer movement
      // happened during it (see d3-drag's own `yesdrag`/`noclick`); a
      // true zero-movement press-release still fires a normal click that
      // reaches this handler undisturbed, so there's no need to reimplement
      // click detection inside the drag behavior above.
      circle.on("click", function (event, d) {
        event.stopPropagation();
        selectedId = selectedId === d.id ? null : d.id;
        applySelection();
      });

      // Clicking the background clears the selection. A click that started
      // on a node stopPropagation()s above before it can bubble here — but
      // only for a true click; a real drag's click gets suppressed by
      // d3-drag itself before it's dispatched at all, so this never runs
      // for one of those either.
      svg.on("click", () => {
        if (selectedId === null) return;
        selectedId = null;
        applySelection();
      });

      // Direct zoom/pan (#23 follow-up) — the same `d3.zoom` mechanism
      // InteractiveLine/InteractiveArea use for their own direct zoom mode
      // (see #14's locked decision), just applied as a plain 2D transform
      // on `g` instead of rescaling an axis: a force layout has no
      // meaningful "domain" to zoom into, only a viewport onto the same
      // fixed node positions.
      svg.call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent(zoomExtent)
          .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
            g.attr("transform", event.transform.toString());
          }),
      );

      // Replaces the native <title> the pre-#23 PeopleNetworkChart used —
      // shared hover tooltip instead, matching every other primitive's
      // per-mark hover pattern (also reachable via keyboard focus, which a
      // native <title> never was). Cast to attachMarkHover's own BaseType
      // signature: `circle`'s parent element type is pinned to SVGGElement
      // (needed above for the `.call(d3.drag<SVGGElement, ...>())` typing),
      // which TS won't structurally match against attachMarkHover's generic
      // BaseType parent — same underlying selection either way.
      attachMarkHover<SimNode>(circle as unknown as d3.Selection<d3.BaseType, SimNode, d3.BaseType, unknown>, {
        onHover: (d, clientPos) => setHovered({ node: d, clientPos }),
        onLeave: () => setHovered(null),
      });
    },
    [nodes, allEdges, minEdgeWeight, width, height, color, radiusRange, strokeRange, zoomExtent],
  );

  const containerRect = containerEl?.getBoundingClientRect();

  return (
    <div ref={setContainerEl} style={{ position: "relative", width, height }} role="img" aria-label={ariaLabel}>
      <svg ref={ref} />
      {hovered && containerRect ? (
        <ChartTooltip
          x={hovered.clientPos.x - containerRect.left}
          y={hovered.clientPos.y - containerRect.top}
          title={hovered.node.label}
          rows={[
            { label: countLabel(hovered.node.count), value: `${hovered.node.count}`, color: resolveColor(hovered.node) },
          ]}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
