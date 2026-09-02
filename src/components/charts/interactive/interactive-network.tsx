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
  /** Node fill — a single color, since a network graph's nodes are one
   * undifferentiated series (size is the only per-node encoding); defaults
   * to `categoricalColor(0)` rather than a fixed hex, so it still tracks
   * light/dark mode like every other primitive's default. */
  color?: string;
  /** `d3.scaleSqrt` range, px — node radius by count. */
  radiusRange?: [number, number];
  /** `d3.scaleLinear` range, px — edge stroke width by weight. */
  strokeRange?: [number, number];
  /** Label for the tooltip's count row, given the hovered node's count —
   * e.g. `(n) => `day${n === 1 ? "" : "s"}`` for a per-day co-occurrence
   * count. Defaults to the generic "count". */
  countLabel?: (count: number) => string;
  ariaLabel?: string;
};

export function InteractiveNetwork({
  nodes,
  edges,
  width,
  height,
  color = categoricalColor(0),
  radiusRange = [3, 16],
  strokeRange = [0.5, 3],
  countLabel = () => "count",
  ariaLabel = "Force-directed network graph. Hover a node to see its label and count; drag to reposition.",
}: InteractiveNetworkProps) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // A state-backed callback ref, not a plain useRef — see interactive-hist's
  // own comment on why this needs to be state, not a ref read during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (nodes.length === 0) return;

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
              d.fx = d.x;
              d.fy = d.y;
            })
            .on("drag", (event, d) => {
              d.fx = event.x;
              d.fy = event.y;
              d3.select(event.sourceEvent.currentTarget).attr(
                "transform",
                `translate(${event.x},${event.y})`,
              );
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
        .attr("fill", color)
        .attr("fill-opacity", 0.85);

      node
        .append("text")
        .attr("x", (d) => radiusScale(d.count) + 3)
        .attr("y", 3)
        .attr("fill", "var(--foreground)")
        .style("font-size", "10px")
        .style("pointer-events", "none")
        .text((d) => d.label);

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
    [nodes, edges, width, height, color, radiusRange, strokeRange],
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
          rows={[{ label: countLabel(hovered.node.count), value: `${hovered.node.count}`, color }]}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
