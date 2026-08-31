"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { styleAxis } from "@/components/charts/interactive/axis";
import { MARK_SPECS, attachMarkHover, roundedBarPath } from "@/components/charts/interactive/marks";
import { ChartTooltip } from "@/components/charts/interactive/tooltip";
import { Legend } from "@/components/charts/interactive/legend";
import { categoricalColor } from "@/lib/viz/color";
import type { GymWeightComboData } from "@/lib/charts";

const MARGIN = { top: 12, right: 48, bottom: 28, left: 48 };

function parseMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

type WeightPt = { date: Date; weightKg: number };
type MonthBar = { start: Date; end: Date; count: number };
type Hovered = { label: string; value: string; color: string; clientPos: { x: number; y: number } };

function Combo({
  weight,
  months,
  width,
  height,
  onHover,
  onLeave,
}: {
  weight: WeightPt[];
  months: MonthBar[];
  width: number;
  height: number;
  onHover: (hovered: Hovered) => void;
  onLeave: () => void;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = height - MARGIN.top - MARGIN.bottom;

      const allDates = [...weight.map((w) => w.date), ...months.flatMap((m) => [m.start, m.end])];
      const domain = d3.extent(allDates) as [Date | undefined, Date | undefined];
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

      // Dual-axis on purpose here (weight/kg vs. workouts/month, two
      // unrelated units) — NOT a pattern to extend to new charts; the
      // dataviz skill's #1 non-negotiable is never a dual-axis chart, and
      // this pre-existing one is why drawStandardAxes (axis.ts) only
      // covers the single-axis case and this file calls styleAxis
      // per-axis instead. Left as-is: restructuring it (e.g. into two
      // indexed-to-a-common-base series, or small multiples) is outside
      // #17's scope.
      const xAxisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
      styleAxis(xAxisG, d3.axisBottom(x).ticks(Math.max(2, Math.floor(innerWidth / 90))));

      const yWeightAxisG = g.append("g");
      styleAxis(yWeightAxisG, d3.axisLeft(yWeight).ticks(5).tickFormat((d) => `${d} kg`), {
        textColor: "var(--chart-1)",
      });

      const yCountAxisG = g.append("g").attr("transform", `translate(${innerWidth},0)`);
      styleAxis(yCountAxisG, d3.axisRight(yCount).ticks(5), { textColor: "var(--chart-2)" });

      // Bars: workouts logged per calendar month. Each bar is its own hit
      // target (no crosshair on a bar chart) — attachMarkHover wires the
      // lift-on-hover + pointermove/focus callback.
      const bars = g
        .selectAll("path")
        .data(months)
        .join("path")
        .attr("d", (d) => {
          const slotX0 = x(d.start);
          const slotX1 = x(d.end);
          const slotWidth = Math.max(0, slotX1 - slotX0 - MARK_SPECS.bar.surfaceGap);
          const barWidth = Math.min(slotWidth, MARK_SPECS.bar.maxThickness);
          const barX = slotX0 + (slotX1 - slotX0 - barWidth) / 2;
          const barHeight = innerHeight - yCount(d.count);
          return roundedBarPath(barX, yCount(d.count), barWidth, barHeight, "up");
        })
        .attr("fill", categoricalColor(1))
        .attr("fill-opacity", 0.55);

      attachMarkHover<MonthBar>(bars, {
        onHover: (d, clientPos) =>
          onHover({
            label: `${d.count} workout${d.count === 1 ? "" : "s"}`,
            value: `${d.count}`,
            color: categoricalColor(1),
            clientPos,
          }),
        onLeave,
      });

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
          .attr("stroke-width", MARK_SPECS.line.strokeWidth)
          .attr("d", line);
      }
    },
    [weight, months, width, height, onHover, onLeave],
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

  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRect = containerEl?.getBoundingClientRect();

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" wrapperRef={setContainerEl}>
        {({ width, height }) => (
          <>
            <Combo
              weight={weight}
              months={months}
              width={width}
              height={height}
              onHover={setHovered}
              onLeave={() => setHovered(null)}
            />
            {hovered && containerRect ? (
              <ChartTooltip
                x={hovered.clientPos.x - containerRect.left}
                y={hovered.clientPos.y - containerRect.top}
                rows={[{ label: hovered.label, value: hovered.value, color: hovered.color }]}
                containerWidth={width}
              />
            ) : null}
          </>
        )}
      </ResponsiveChart>
      <Legend
        series={[
          { label: "weight", color: categoricalColor(0) },
          { label: "workouts", color: categoricalColor(1) },
        ]}
      />
    </div>
  );
}
