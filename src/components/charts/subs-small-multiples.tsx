"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { SUB_NAMES } from "@/lib/days";
import type { SubsSeries } from "@/lib/charts";

const MINI_HEIGHT = 64;
const MARGIN = { top: 16, right: 4, bottom: 4, left: 4 };

// Nine simultaneous series is more than the app's 5-wide chart-1..5 palette
// covers, and overlaying all nine on one set of axes (rather than these
// small multiples) would be unreadable regardless of color — this is the
// one place in the chart layer that reaches for d3's own qualitative
// scheme instead of the theme tokens.
const COLORS = d3.schemeTableau10;

type MiniPoint = { date: Date; value: number };

function MiniLine({
  name,
  color,
  points,
  width,
  height,
}: {
  name: string;
  color: string;
  points: MiniPoint[];
  width: number;
  height: number;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = height - MARGIN.top - MARGIN.bottom;

      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      g.append("text")
        .attr("x", 0)
        .attr("y", -6)
        .attr("fill", "var(--foreground)")
        .style("font-size", "11px")
        .style("font-weight", 500)
        .text(name);

      if (points.length === 0) return;

      const x = d3
        .scaleTime()
        .domain(d3.extent(points, (p) => p.date) as [Date, Date])
        .range([0, innerWidth]);
      const y = d3.scaleLinear().domain([0, 10]).range([innerHeight, 0]);

      const line = d3
        .line<MiniPoint>()
        .x((d) => x(d.date))
        .y((d) => y(d.value))
        .curve(d3.curveMonotoneX);

      g.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("d", line);
    },
    [name, color, points, width, height],
  );

  return <svg ref={ref} />;
}

function SubMiniChart({
  name,
  color,
  points,
}: {
  name: string;
  color: string;
  points: MiniPoint[];
}) {
  return (
    <ResponsiveChart height={MINI_HEIGHT} minWidth={120}>
      {({ width, height }) => (
        <MiniLine name={name} color={color} points={points} width={width} height={height} />
      )}
    </ResponsiveChart>
  );
}

/** A 3x3 grid of sparkline-style mini charts, one per sub — the legacy
 * `subs_scroller` (functions/views/vis/charts/subs_scroller.js) plots all
 * nine on one shared axis, but nine overlapping 0-10 lines over years of
 * daily data reads as noise; small multiples (one chart per series, shared
 * y-domain) trade overlay-comparison for per-series legibility, which is
 * the better tradeoff here since each sub is really its own habit-tracking
 * signal rather than a value naturally compared against the others. */
export function SubsSmallMultiples({ data }: { data: SubsSeries[] }) {
  const seriesByName = useMemo(() => {
    return SUB_NAMES.map((name, i) => {
      const points: MiniPoint[] = [];
      for (const row of data) {
        const value = row.values[i];
        if (value === null || value === undefined) continue;
        points.push({ date: new Date(`${row.date}T00:00:00`), value });
      }
      return { name, points };
    });
  }, [data]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {seriesByName.map(({ name, points }, i) => (
        <div key={name} className="rounded-md border border-border p-2">
          <SubMiniChart name={name} color={COLORS[i % COLORS.length]} points={points} />
        </div>
      ))}
    </div>
  );
}
