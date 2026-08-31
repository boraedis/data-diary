"use client";

import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import type { NetworkEdge, NetworkNode, PeopleNetworkData } from "@/lib/charts";

type SimNode = NetworkNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { weight: number };

function asNode(v: SimLink["source"]): SimNode {
  // Safe once the simulation has ticked: d3.forceLink replaces the raw
  // source/target ids with references to the actual node objects on its
  // first tick.
  return v as SimNode;
}

function Network({
  nodes,
  edges,
  width,
  height,
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  width: number;
  height: number;
}) {
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
        .range([3, 16]);
      const strokeScale = d3
        .scaleLinear()
        .domain([0, d3.max(edges, (e) => e.weight) ?? 1])
        .range([0.5, 3]);

      // Run the simulation to convergence synchronously instead of
      // animating it frame-by-frame (the legacy app's force graphs, like
      // most of its charts, ran on a live re-render loop) — this is a
      // static layout once mounted, with drag-to-reposition as the one
      // interactive affordance, rather than a continuously ticking
      // physics sim.
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

      node
        .append("circle")
        .attr("r", (d) => radiusScale(d.count))
        .attr("fill", "var(--chart-1)")
        .attr("fill-opacity", 0.85);

      node
        .append("text")
        .attr("x", (d) => radiusScale(d.count) + 3)
        .attr("y", 3)
        .attr("fill", "var(--foreground)")
        .style("font-size", "10px")
        .style("pointer-events", "none")
        .text((d) => d.name);

      node.append("title").text((d) => `${d.name}: ${d.count} day${d.count === 1 ? "" : "s"}`);
    },
    [nodes, edges, width, height],
  );

  return <svg ref={ref} />;
}

/** A force-directed co-occurrence graph of the people most often logged
 * together — the legacy `people_network` chart, simplified from a live
 * `forceSimulation` + `setInterval` re-tick loop into a one-time layout
 * (drag a node to reposition it; nothing else moves in response, unlike
 * the legacy live physics — a deliberate simplification, not an
 * oversight). Node size = how many days that person was logged; edge
 * thickness = how many days two people were logged together. */
export function PeopleNetworkChart({ data }: { data: PeopleNetworkData }) {
  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
      {({ width, height }) => (
        <Network nodes={data.nodes} edges={data.edges} width={width} height={height} />
      )}
    </ResponsiveChart>
  );
}
