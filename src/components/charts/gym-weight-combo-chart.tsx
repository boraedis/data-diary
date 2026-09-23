"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { styleAxis } from "@/components/charts/interactive/axis";
import { MARK_SPECS, attachMarkHover, roundedBarPath } from "@/components/charts/interactive/marks";
import { ChartTooltip } from "@/components/charts/interactive/tooltip";
import { Legend } from "@/components/charts/interactive/legend";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { parseDate } from "@/lib/date";
import { categoricalColor } from "@/lib/viz/color";
import { formatDate, formatDuration } from "@/lib/viz/format";
import type { GymWeightComboData } from "@/lib/charts";
import { COMBO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { TRAINING_METHODOLOGY, WEIGHT_METHODOLOGY } from "@/lib/viz/methodology";
import { TRAINING_TRACKING_SPAN } from "@/lib/viz/tracking-span";

const MARGIN = { top: 12, right: 48, bottom: 28, left: 48 };

function parseMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

type WeightPt = { date: Date; dateStr: string; weightKg: number };
type MonthBar = { start: Date; end: Date; hours: number };
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

      // Each series' range covers only 3/4 of the chart height rather than
      // the full height, offset to opposite ends — weight (line) keeps
      // clear of the bottom quarter, hours (bars) keep clear of the top
      // quarter. The two 3/4 spans still overlap through the middle
      // (where a real crossing reads fine), but a line trough and a bar
      // peak no longer compete for the same pixels at the extremes, which
      // is where the two series were hardest to tell apart on one plot.
      const LANE_FRACTION = 0.75;

      const weightExtent = weight.length
        ? (d3.extent(weight, (w) => w.weightKg) as [number, number])
        : [0, 1];
      const weightPad = (weightExtent[1] - weightExtent[0]) * 0.1 || 1;
      const yWeight = d3
        .scaleLinear()
        .domain([weightExtent[0] - weightPad, weightExtent[1] + weightPad])
        .range([innerHeight * LANE_FRACTION, 0]);

      const yHours = d3
        .scaleLinear()
        .domain([0, d3.max(months, (m) => m.hours) ?? 1])
        .nice()
        .range([innerHeight, innerHeight * (1 - LANE_FRACTION)]);

      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      // Dual-axis on purpose here (weight/kg vs. weightlifting hours/month,
      // two unrelated units) — NOT a pattern to extend to new charts; the
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

      const yHoursAxisG = g.append("g").attr("transform", `translate(${innerWidth},0)`);
      styleAxis(yHoursAxisG, d3.axisRight(yHours).ticks(5).tickFormat((d) => `${d}h`), {
        textColor: "var(--chart-2)",
      });

      // Bars: hours of strength-category workouts logged per calendar
      // month (#325 — this used to plot a raw count of every logged
      // workout, across every category). Each bar is its own hit target
      // (no crosshair on a bar chart) — attachMarkHover wires the
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
          const barHeight = innerHeight - yHours(d.hours);
          return roundedBarPath(barX, yHours(d.hours), barWidth, barHeight, "up");
        })
        .attr("fill", categoricalColor(1))
        .attr("fill-opacity", 0.55);

      attachMarkHover<MonthBar>(bars, {
        onHover: (d, clientPos) =>
          onHover({
            label: formatDuration(d.hours),
            value: formatDuration(d.hours),
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

        // Per-point hit targets so the line gets the same hover/tooltip
        // treatment as the bars (#332 — the line previously had no pointer
        // handlers at all). Invisible until hover, at which point
        // attachMarkHover's own opacity lift doubles as the "you're on a
        // point" affordance instead of needing a separately-drawn dot.
        const points = g
          .selectAll("circle")
          .data(weight)
          .join("circle")
          .attr("cx", (d) => x(d.date))
          .attr("cy", (d) => yWeight(d.weightKg))
          .attr("r", MARK_SPECS.hover.minHitTarget / 2)
          .attr("fill", "var(--chart-1)")
          .attr("fill-opacity", 0);

        attachMarkHover<WeightPt>(points, {
          onHover: (d, clientPos) =>
            onHover({
              label: formatDate(d.dateStr),
              value: `${d.weightKg.toFixed(1)} kg`,
              color: categoricalColor(0),
              clientPos,
            }),
          onLeave,
        });
      }
    },
    [weight, months, width, height, onHover, onLeave],
  );

  return <svg ref={ref} />;
}

/** Body weight (line, left axis) alongside weightlifting volume (bars,
 * right axis, hours of strength-category workouts per calendar month) —
 * the legacy app's bespoke dual-axis `LineBarChart` from
 * gym-weight_chart.js, generalized into this shared component's config
 * surface instead of copied as one-off code.
 *
 * Owns its own page shell (ChartPage + filters + card), same reason every
 * other filtered chart in this app does: the range picker below and the
 * chart share client state, and pages are server components. `data` is
 * the *full* weight/training history — the `TimeRangePicker`'s own domain
 * spans all of it, so older dates stay reachable — but the picker's
 * initial value (#411) defaults to `defaultRangeStart` through the latest
 * date, focusing the first paint on the region where both fields actually
 * have data, rather than opening on years of weight-only history with no
 * training to compare it against. */
export function GymWeightComboChart({
  data,
  defaultRangeStart,
}: {
  data: GymWeightComboData;
  /** Where the range picker's *initial* selection should start — typically
   * `getFirstExerciseDate()`. Omit to default to the full domain, same as
   * every other range picker in this app. Doesn't restrict what's
   * reachable; the user can still drag back past it. */
  defaultRangeStart?: string | null;
}) {
  const fullDomain = useMemo<[Date, Date] | null>(() => {
    const dates = [...data.weight.map((w) => parseDate(w.date)), ...data.workoutsByMonth.map((m) => parseMonth(m.month))];
    const extent = d3.extent(dates);
    return extent[0] && extent[1] ? (extent as [Date, Date]) : null;
  }, [data.weight, data.workoutsByMonth]);
  const [range, setRange] = useState<[Date, Date] | null>(() => {
    if (!defaultRangeStart || !fullDomain) return null;
    const start = parseDate(defaultRangeStart);
    return start < fullDomain[1] ? [start, fullDomain[1]] : null;
  });

  const weight = useMemo<WeightPt[]>(() => {
    const [from, to] = range ?? [];
    return data.weight
      .filter((w) => !from || !to || (parseDate(w.date) >= from && parseDate(w.date) <= to))
      .map((w) => ({ date: new Date(w.date), dateStr: w.date, weightKg: w.weightKg }));
  }, [data.weight, range]);
  const months = useMemo<MonthBar[]>(() => {
    const [from, to] = range ?? [];
    return data.workoutsByMonth
      .filter((m) => !from || !to || (parseMonth(m.month) >= from && parseMonth(m.month) <= to))
      .map((m) => {
        const start = parseMonth(m.month);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        return { start, end, hours: m.hours };
      });
  }, [data.workoutsByMonth, range]);

  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRect = containerEl?.getBoundingClientRect();

  const empty = data.weight.length === 0 && data.workoutsByMonth.length === 0;

  return (
    <ChartPage
      title="Weight and Training Volume"
      description="My weight against total weightlifting hours each month — a way to see whether time at the gym is helping build muscle."
      info={{
        interactionGuide: COMBO_INTERACTION_GUIDE,
        methodology: `${WEIGHT_METHODOLOGY} ${TRAINING_METHODOLOGY}`,
        // The later of the two fields' own start dates — training data is
        // what actually limits how far back this combo chart's bars go.
        trackingSpan: TRAINING_TRACKING_SPAN,
      }}
      filters={fullDomain ? <TimeRangePicker domain={fullDomain} value={range} onChange={setRange} /> : null}
    >
      <ChartCard empty={empty}>
        <div className="flex flex-col gap-2">
          <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport wrapperRef={setContainerEl}>
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
              { label: "weightlifting hours", color: categoricalColor(1) },
            ]}
          />
        </div>
      </ChartCard>
    </ChartPage>
  );
}
