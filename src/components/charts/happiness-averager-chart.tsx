"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { drawStandardAxes } from "@/components/charts/interactive/axis";
import { MARK_SPECS } from "@/components/charts/interactive/marks";
import { ChartTooltip, useCrosshair } from "@/components/charts/interactive/tooltip";
import { categoricalColor } from "@/lib/viz/color";
import { formatDate } from "@/lib/viz/format";
import type { MonthlyAverage } from "@/lib/charts";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 32 };

// `monthStr` ("YYYY-MM-01") rides alongside `date` so the tooltip can call
// formatDate on the original string instead of round-tripping back through
// `Date` (toISOString is UTC-based and can shift the calendar day in a
// positive-UTC-offset timezone — see format.ts's own header note on why
// this codebase never does that).
type Point = { date: Date; monthStr: string; avg: number; count: number };

function Averager({
  points,
  width,
  height,
}: {
  points: Point[];
  width: number;
  height: number;
}) {
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  // x/radius are recomputed here (not just inside useD3 below) because the
  // crosshair below needs each point's pixel X in React state, outside the
  // useD3-controlled <svg> — see tooltip.tsx's useCrosshair doc comment for
  // why that has to live outside the d3-rendered subtree. Both this and the
  // useD3 effect key off the same `points`/`innerWidth` deps, so they never
  // disagree on where a point actually sits.
  const x = useMemo(
    () =>
      d3
        .scaleTime()
        .domain(d3.extent(points, (p) => p.date) as [Date, Date])
        .range([0, innerWidth]),
    [points, innerWidth],
  );
  const y = useMemo(() => d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]), [innerHeight]);
  // Marker radius scales with how many days fed that month's average — a
  // month averaged from 30 entries reads as more confident than one
  // averaged from 2.
  const radius = useMemo(
    () =>
      d3
        .scaleSqrt()
        .domain([0, d3.max(points, (p) => p.count) ?? 1])
        .range([1.5, 5]),
    [points],
  );

  const xPositions = useMemo(() => points.map((p) => x(p.date)), [points, x]);
  const crosshair = useCrosshair(points, xPositions);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      drawStandardAxes({ g, x, y, innerWidth, innerHeight, yTicks: 5 });

      const line = d3
        .line<Point>()
        .x((d) => x(d.date))
        .y((d) => y(d.avg))
        .curve(d3.curveMonotoneX);

      g.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", "var(--chart-1)")
        .attr("stroke-width", MARK_SPECS.line.strokeWidth)
        .attr("d", line);

      g.selectAll("circle")
        .data(points)
        .join("circle")
        .attr("cx", (d) => x(d.date))
        .attr("cy", (d) => y(d.avg))
        .attr("r", (d) => radius(d.count))
        .attr("fill", "var(--chart-1)")
        .attr("stroke", "var(--card)")
        .attr("stroke-width", MARK_SPECS.marker.ringWidth);
    },
    [points, width, height, x, y, radius],
  );

  const hovered = crosshair.point;

  return (
    <>
      <svg ref={ref} />
      {/* Crosshair interaction surface — a plain HTML overlay, not part of
          the d3-rendered <svg>, so pointer moves update only this and never
          re-trigger the full chart redraw (useD3 wipes+rebuilds its whole
          <svg> on every dependency change). */}
      <div
        className="absolute"
        style={{ left: MARGIN.left, top: MARGIN.top, width: innerWidth, height: innerHeight }}
        role="img"
        aria-label="Monthly average happiness over time. Use arrow keys to inspect individual months, or hover a point."
        {...crosshair.handlers}
      >
        {crosshair.pixelX !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
            style={{ left: crosshair.pixelX }}
          />
        ) : null}
      </div>
      {hovered ? (
        <ChartTooltip
          x={MARGIN.left + (crosshair.pixelX ?? 0)}
          y={MARGIN.top + y(hovered.avg)}
          title={formatDate(hovered.monthStr, "monthYear")}
          rows={[
            {
              label: `${hovered.count} day${hovered.count === 1 ? "" : "s"}`,
              value: hovered.avg.toFixed(1),
              color: categoricalColor(0),
            },
          ]}
          containerWidth={width}
        />
      ) : null}
    </>
  );
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
        return { date: new Date(y, m - 1, 1), monthStr: `${d.month}-01`, avg: d.avg, count: d.count };
      }),
    [data],
  );

  return (
    <ResponsiveChart height={240}>
      {({ width, height }) => <Averager points={points} width={width} height={height} />}
    </ResponsiveChart>
  );
}
