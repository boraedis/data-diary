"use client";

import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 36 };

function Histogram({
  values,
  width,
  height,
}: {
  values: number[];
  width: number;
  height: number;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = height - MARGIN.top - MARGIN.bottom;

      const x = d3.scaleLinear().domain([0, 100]).range([0, innerWidth]);
      // 10-wide buckets over the fixed 0-100 happiness scale, rather than
      // d3.bin()'s default Sturges rule — a domain-meaningful bucket width
      // (one bucket per 10 points) reads better here than an
      // auto-picked one.
      const bins = d3
        .bin()
        .domain([0, 100])
        .thresholds(d3.range(0, 101, 10))(values);

      const y = d3
        .scaleLinear()
        .domain([0, d3.max(bins, (b) => b.length) ?? 0])
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(10))
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

      g.selectAll("rect")
        .data(bins)
        .join("rect")
        .attr("x", (d) => x(d.x0 ?? 0) + 1)
        .attr("width", (d) => Math.max(0, x(d.x1 ?? 0) - x(d.x0 ?? 0) - 2))
        .attr("y", (d) => y(d.length))
        .attr("height", (d) => innerHeight - y(d.length))
        .attr("fill", "var(--chart-1)")
        .attr("rx", 2);
    },
    [values, width, height],
  );

  return <svg ref={ref} />;
}

export function HistogramChart({ values }: { values: number[] }) {
  return (
    <ResponsiveChart height={260}>
      {({ width, height }) => <Histogram values={values} width={width} height={height} />}
    </ResponsiveChart>
  );
}
