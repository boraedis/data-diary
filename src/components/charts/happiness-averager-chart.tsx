"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import type { MonthlyAverage } from "@/lib/charts";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 32 };

type Point = { date: Date; avg: number; count: number };

function Averager({
  points,
  width,
  height,
}: {
  points: Point[];
  width: number;
  height: number;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = height - MARGIN.top - MARGIN.bottom;

      const x = d3
        .scaleTime()
        .domain(d3.extent(points, (p) => p.date) as [Date, Date])
        .range([0, innerWidth]);
      const y = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);
      // Marker radius scales with how many days fed that month's average —
      // a month averaged from 30 entries reads as more confident than one
      // averaged from 2.
      const radius = d3
        .scaleSqrt()
        .domain([0, d3.max(points, (p) => p.count) ?? 1])
        .range([1.5, 5]);

      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(innerWidth / 90))))
        .call((axis) =>
          axis.selectAll("text").attr("fill", "var(--muted-foreground)").style("font-size", "11px"),
        )
        .call((axis) => axis.selectAll("line,path").attr("stroke", "var(--border)"));

      g.append("g")
        .call(d3.axisLeft(y).ticks(5))
        .call((axis) =>
          axis.selectAll("text").attr("fill", "var(--muted-foreground)").style("font-size", "11px"),
        )
        .call((axis) => axis.selectAll("line,path").attr("stroke", "var(--border)"));

      const line = d3
        .line<Point>()
        .x((d) => x(d.date))
        .y((d) => y(d.avg))
        .curve(d3.curveMonotoneX);

      g.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", "var(--chart-1)")
        .attr("stroke-width", 2)
        .attr("d", line);

      g.selectAll("circle")
        .data(points)
        .join("circle")
        .attr("cx", (d) => x(d.date))
        .attr("cy", (d) => y(d.avg))
        .attr("r", (d) => radius(d.count))
        .attr("fill", "var(--chart-1)")
        .append("title")
        .text(
          (d) =>
            `${d3.timeFormat("%b %Y")(d.date)}: avg ${d.avg.toFixed(1)} (${d.count} day${d.count === 1 ? "" : "s"})`,
        );
    },
    [points, width, height],
  );

  return <svg ref={ref} />;
}

/** Monthly average happiness, one point per month sized by how many days
 * fed it — the legacy "Averager" pattern (functions/views/vis/charts/
 * happiness_averager.js), which bins a noisy day-by-day signal down to a
 * readable trend line rather than plotting every raw point (that's what
 * /charts/happiness's histogram and a future scroller are for instead). */
export function HappinessAveragerChart({ data }: { data: MonthlyAverage[] }) {
  const points = useMemo<Point[]>(
    () =>
      data.map((d) => {
        const [y, m] = d.month.split("-").map(Number);
        return { date: new Date(y, m - 1, 1), avg: d.avg, count: d.count };
      }),
    [data],
  );

  return (
    <ResponsiveChart height={240}>
      {({ width, height }) => <Averager points={points} width={width} height={height} />}
    </ResponsiveChart>
  );
}
