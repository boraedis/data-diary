"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import type { GymWeightComboData } from "@/lib/charts";

const MARGIN = { top: 12, right: 48, bottom: 28, left: 48 };

function parseMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

type WeightPt = { date: Date; weightKg: number };
type MonthBar = { start: Date; end: Date; count: number };

function Combo({
  weight,
  months,
  width,
  height,
}: {
  weight: WeightPt[];
  months: MonthBar[];
  width: number;
  height: number;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = height - MARGIN.top - MARGIN.bottom;

      const allDates = [...weight.map((w) => w.date), ...months.flatMap((m) => [m.start, m.end])];
      const domain = (d3.extent(allDates) as [Date | undefined, Date | undefined]);
      const x = d3
        .scaleTime()
        .domain([domain[0] ?? new Date(), domain[1] ?? new Date()])
        .range([0, innerWidth]);

      const weightExtent = weight.length
        ? (d3.extent(weight, (w) => w.weightKg) as [number, number])
        : [0, 1];
      const weightPad = (weightExtent[1] - weightExtent[0]) * 0.1 || 1;
      const yWeight = d3
        .scaleLinear()
        .domain([weightExtent[0] - weightPad, weightExtent[1] + weightPad])
        .range([innerHeight, 0]);

      const yCount = d3
        .scaleLinear()
        .domain([0, d3.max(months, (m) => m.count) ?? 1])
        .nice()
        .range([innerHeight, 0]);

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
        .call(d3.axisLeft(yWeight).ticks(5).tickFormat((d) => `${d} kg`))
        .call((axis) =>
          axis.selectAll("text").attr("fill", "var(--chart-1)").style("font-size", "11px"),
        )
        .call((axis) => axis.selectAll("line,path").attr("stroke", "var(--border)"));

      g.append("g")
        .attr("transform", `translate(${innerWidth},0)`)
        .call(d3.axisRight(yCount).ticks(5))
        .call((axis) =>
          axis.selectAll("text").attr("fill", "var(--chart-2)").style("font-size", "11px"),
        )
        .call((axis) => axis.selectAll("line,path").attr("stroke", "var(--border)"));

      // Bars: workouts logged per calendar month.
      g.selectAll("rect")
        .data(months)
        .join("rect")
        .attr("x", (d) => x(d.start) + 1)
        .attr("width", (d) => Math.max(0, x(d.end) - x(d.start) - 2))
        .attr("y", (d) => yCount(d.count))
        .attr("height", (d) => innerHeight - yCount(d.count))
        .attr("fill", "var(--chart-2)")
        .attr("fill-opacity", 0.55)
        .append("title")
        .text((d) => `${d.count} workout${d.count === 1 ? "" : "s"}`);

      // Line: weight.
      if (weight.length) {
        const line = d3
          .line<WeightPt>()
          .x((d) => x(d.date))
          .y((d) => yWeight(d.weightKg))
          .curve(d3.curveMonotoneX);

        g.append("path")
          .datum(weight)
          .attr("fill", "none")
          .attr("stroke", "var(--chart-1)")
          .attr("stroke-width", 2)
          .attr("d", line);
      }
    },
    [weight, months, width, height],
  );

  return <svg ref={ref} />;
}

/** Body weight (line, left axis) alongside workout frequency (bars, right
 * axis, one per calendar month) — the legacy app's bespoke dual-axis
 * `LineBarChart` from gym-weight_chart.js, generalized into this shared
 * component's config surface instead of copied as one-off code. */
export function GymWeightComboChart({ data }: { data: GymWeightComboData }) {
  const weight = useMemo<WeightPt[]>(
    () => data.weight.map((w) => ({ date: new Date(w.date), weightKg: w.weightKg })),
    [data.weight],
  );
  const months = useMemo<MonthBar[]>(
    () =>
      data.workoutsByMonth.map((m) => {
        const start = parseMonth(m.month);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        return { start, end, count: m.count };
      }),
    [data.workoutsByMonth],
  );

  return (
    <ResponsiveChart height={260}>
      {({ width, height }) => (
        <Combo weight={weight} months={months} width={width} height={height} />
      )}
    </ResponsiveChart>
  );
}
