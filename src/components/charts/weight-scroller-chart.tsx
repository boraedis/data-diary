"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import type { WeightPoint } from "@/lib/charts";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const MAIN_HEIGHT = 220;
const OVERVIEW_HEIGHT = 64;

type Point = { date: Date; weightKg: number };

function MainLine({
  points,
  width,
  domain,
}: {
  points: Point[];
  width: number;
  domain: [Date, Date];
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = MAIN_HEIGHT - MARGIN.top - MARGIN.bottom;

      const visible = points.filter((p) => p.date >= domain[0] && p.date <= domain[1]);
      const forExtent = visible.length ? visible : points;

      const x = d3.scaleTime().domain(domain).range([0, innerWidth]);
      const yExtent = d3.extent(forExtent, (p) => p.weightKg) as [number, number];
      const pad = (yExtent[1] - yExtent[0]) * 0.1 || 1;
      const y = d3
        .scaleLinear()
        .domain([yExtent[0] - pad, yExtent[1] + pad])
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", MAIN_HEIGHT)
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
        .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${d} kg`))
        .call((axis) =>
          axis.selectAll("text").attr("fill", "var(--muted-foreground)").style("font-size", "11px"),
        )
        .call((axis) => axis.selectAll("line,path").attr("stroke", "var(--border)"));

      const line = d3
        .line<Point>()
        .x((d) => x(d.date))
        .y((d) => y(d.weightKg))
        .curve(d3.curveMonotoneX);

      g.append("path")
        .datum(visible)
        .attr("fill", "none")
        .attr("stroke", "var(--chart-1)")
        .attr("stroke-width", 2)
        .attr("d", line);

      // Only draw point markers when there aren't too many to read cleanly.
      if (visible.length < 150) {
        g.selectAll("circle")
          .data(visible)
          .join("circle")
          .attr("cx", (d) => x(d.date))
          .attr("cy", (d) => y(d.weightKg))
          .attr("r", 2.5)
          .attr("fill", "var(--chart-1)");
      }
    },
    [points, width, domain[0].getTime(), domain[1].getTime()],
  );

  return <svg ref={ref} />;
}

function Overview({
  points,
  width,
  fullExtent,
  onBrush,
}: {
  points: Point[];
  width: number;
  fullExtent: [Date, Date];
  onBrush: (domain: [Date, Date] | null) => void;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = OVERVIEW_HEIGHT - 8;

      const x = d3.scaleTime().domain(fullExtent).range([0, innerWidth]);
      const y = d3
        .scaleLinear()
        .domain(d3.extent(points, (p) => p.weightKg) as [number, number])
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", OVERVIEW_HEIGHT)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},4)`);

      const line = d3
        .line<Point>()
        .x((d) => x(d.date))
        .y((d) => y(d.weightKg))
        .curve(d3.curveMonotoneX);

      g.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", "var(--muted-foreground)")
        .attr("stroke-width", 1.5)
        .attr("d", line);

      const brush = d3
        .brushX()
        .extent([
          [0, 0],
          [innerWidth, innerHeight],
        ])
        .on("brush end", (event: d3.D3BrushEvent<unknown>) => {
          if (!event.selection) {
            onBrush(null);
            return;
          }
          const [x0, x1] = event.selection as [number, number];
          onBrush([x.invert(x0), x.invert(x1)]);
        });

      const brushG = g.append("g").call(brush);
      brushG
        .selectAll(".selection")
        .attr("fill", "var(--chart-1)")
        .attr("fill-opacity", 0.15)
        .attr("stroke", "var(--chart-1)");
    },
    // `onBrush` (the parent's setState) is deliberately not a dep — including
    // it would rebuild the brush (and drop the drag gesture) on every state
    // update the brush itself causes. It's a stable setState reference, so
    // this is safe.
    [points, width, fullExtent[0].getTime(), fullExtent[1].getTime()],
  );

  return <svg ref={ref} />;
}

/** A zoomable weight-over-time line: drag on the mini strip below to zoom
 * the main chart into that range, click (no drag) to reset to the full
 * range — the legacy app's "scroller" pattern (functions/views/vis/
 * charts/weight_scroller.js), ported onto d3-brush instead of a hand-rolled
 * slider. */
export function WeightScrollerChart({ data }: { data: WeightPoint[] }) {
  const points = useMemo<Point[]>(
    () => data.map((d) => ({ date: new Date(d.date), weightKg: d.weightKg })),
    [data],
  );
  const fullExtent = useMemo<[Date, Date]>(() => {
    const [lo, hi] = d3.extent(points, (p) => p.date);
    return [lo ?? new Date(), hi ?? new Date()];
  }, [points]);
  const [selection, setSelection] = useState<[Date, Date] | null>(null);

  return (
    <ResponsiveChart height={MAIN_HEIGHT + OVERVIEW_HEIGHT}>
      {({ width }) => (
        <div>
          <MainLine points={points} width={width} domain={selection ?? fullExtent} />
          <Overview
            points={points}
            width={width}
            fullExtent={fullExtent}
            onBrush={setSelection}
          />
        </div>
      )}
    </ResponsiveChart>
  );
}
