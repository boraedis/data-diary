"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { styleAxis } from "@/components/charts/interactive/axis";
import { MARK_SPECS } from "@/components/charts/interactive/marks";
import { ChartTooltip, useCrosshair } from "@/components/charts/interactive/tooltip";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { useD3 } from "@/hooks/use-d3";
import { addDays, parseDate, toDateString } from "@/lib/date";
import type { SleepNight } from "@/lib/charts";
import { categoricalColor } from "@/lib/viz/color";
import { formatDate, formatDuration } from "@/lib/viz/format";
import { SLEEP_HOURS_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { SLEEP_HOURS_METHODOLOGY } from "@/lib/viz/methodology";
import { buildSleepBars, clockTicks, fitClockDomain, formatAxisClock, type SleepBar } from "@/lib/viz/sleep-hours";
import { SLEEP_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Sleep Hours (#212) — legacy's `sleeping_hours`: one vertical bar per
// night, from falling asleep to waking, against a clock-time axis, so the
// shape of a year shows *when* sleep happened and not just how long it
// was. A bespoke chart rather than an InteractiveTimeline consumer: a
// Gantt lays out a handful of long, labelled rows on a calendar axis,
// where this is hundreds of short bars on a repeating 24-hour one. The
// axis arithmetic (origin, fitting, ticks) is pure, in
// `src/lib/viz/sleep-hours.ts`.

/** The same slot the other sleep charts draw sleep in (sleep-charts.tsx),
 * so sleep reads as one colour across the category. */
const SLEEP_COLOR = categoricalColor(4);

const MARGIN = { top: 12, right: 12, bottom: 28, left: 48 };

/**
 * How much history the chart opens on.
 *
 * Density is the design question here: the log holds ~2,600 nights, and
 * at the full extent on a laptop-width card each gets well under a pixel.
 * That isn't useless — the bars merge into a band whose edges are the
 * bedtime and wake-time envelope, which is exactly the shape of the years
 * — but a single night can no longer be picked out. A year is ~365 bars,
 * two or three pixels each, where every night is still its own mark and
 * hover still lands on the night under the pointer. So the chart opens on
 * the latest year, and the range slider reaches back to the start: it's
 * windowed, not aggregated, because averaging nights would erase the
 * night-to-night scatter this chart exists to show (Sleep Trend already
 * does the averaged view).
 */
const DEFAULT_WINDOW_DAYS = 365;

/** Below this bar width the 1px gap between neighbours would eat most of
 * the bar, so bars touch instead and read as a continuous band. */
const GAP_MIN_BAR_WIDTH = 3;

export function SleepHoursChart({ data }: { data: SleepNight[] }) {
  const bars = useMemo(() => buildSleepBars(data), [data]);

  const fullExtent = useMemo<[Date, Date] | null>(
    () => (bars.length ? [parseDate(bars[0].date), parseDate(bars[bars.length - 1].date)] : null),
    [bars],
  );

  const defaultRange = useMemo<[Date, Date] | null>(() => {
    if (!fullExtent) return null;
    const start = parseDate(addDays(toDateString(fullExtent[1]), -DEFAULT_WINDOW_DAYS + 1));
    return start > fullExtent[0] ? [start, fullExtent[1]] : null;
  }, [fullExtent]);

  // `undefined` = untouched, open on the default year; `null` never
  // happens from the slider but keeps the same shape as the life
  // timeline's controlled domain.
  const [range, setRange] = useState<[Date, Date] | null | undefined>(undefined);
  const effectiveRange = range === undefined ? defaultRange : range;

  return (
    <ChartPage
      title="Sleep Hours"
      description="One bar per night, from falling asleep at the top to waking at the bottom. The clock runs noon to noon, so a night that crosses midnight is one unbroken bar."
      info={{
        interactionGuide: SLEEP_HOURS_INTERACTION_GUIDE,
        methodology: SLEEP_HOURS_METHODOLOGY,
        trackingSpan: SLEEP_TRACKING_SPAN,
      }}
      filters={
        fullExtent ? (
          <TimeRangePicker domain={fullExtent} value={effectiveRange} onChange={setRange} label="Period" />
        ) : null
      }
    >
      <ChartCard empty={bars.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={320}>
          {({ width, height }) => (
            <SleepHoursPlot
              bars={bars}
              range={effectiveRange ?? fullExtent}
              width={width}
              height={height}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}

function SleepHoursPlot({
  bars,
  range,
  width,
  height,
}: {
  bars: SleepBar[];
  range: [Date, Date] | null;
  width: number;
  height: number;
}) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const startDate = range ? toDateString(range[0]) : null;
  const endDate = range ? toDateString(range[1]) : null;

  const visible = useMemo(
    () => bars.filter((b) => (startDate === null || b.date >= startDate) && (endDate === null || b.date <= endDate)),
    [bars, startDate, endDate],
  );

  // The time axis spans whole days, the last one included — each night owns
  // [its date, the next date), so the final night gets a full bar's width
  // rather than sitting on the right edge with none.
  const x = useMemo(() => {
    const first = startDate ?? visible[0]?.date;
    const last = endDate ?? visible[visible.length - 1]?.date;
    const domain: [Date, Date] = first && last ? [parseDate(first), parseDate(addDays(last, 1))] : [new Date(), new Date()];
    return d3.scaleTime().domain(domain).range([0, innerWidth]);
  }, [startDate, endDate, visible, innerWidth]);

  const y = useMemo(
    () => d3.scaleLinear().domain(fitClockDomain(visible)).range([0, innerHeight]),
    [visible, innerHeight],
  );

  const dayWidth = useMemo(() => {
    const [d0, d1] = x.domain();
    const days = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86_400_000));
    return innerWidth / days;
  }, [x, innerWidth]);
  const barWidth = Math.min(MARK_SPECS.bar.maxThickness, dayWidth >= GAP_MIN_BAR_WIDTH ? dayWidth - 1 : dayWidth);

  // `fitClockDomain` trims the extremes over a long range, so the odd bar
  // can run past the plot; it's cut at the edge rather than drawn over the
  // axis, and the tooltip still gives its real times.
  const clampY = (minutes: number) => Math.min(innerHeight, Math.max(0, y(minutes)));

  const barLeft = (b: SleepBar) => x(parseDate(b.date)) + (dayWidth - barWidth) / 2;

  // A bar is centred in its day's slot, so its centre doesn't depend on
  // the bar's own width.
  const centers = useMemo(() => visible.map((b) => x(parseDate(b.date)) + dayWidth / 2), [visible, x, dayWidth]);

  const crosshair = useCrosshair(visible, centers);

  const svgRef = useD3<SVGSVGElement>(
    (svg) => {
      if (innerWidth <= 0 || innerHeight <= 0) return;
      const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      const ticks = clockTicks(y.domain() as [number, number], innerHeight);

      // Gridlines at the clock ticks, behind the bars.
      g.append("g")
        .attr("aria-hidden", "true")
        .selectAll("line")
        .data(ticks)
        .join("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", (t) => y(t))
        .attr("y2", (t) => y(t))
        .attr("stroke", "var(--border)")
        .attr("stroke-opacity", 0.6);

      const radius = barWidth >= 6 ? 2 : 0;
      g.append("g")
        .attr("aria-hidden", "true")
        .selectAll("rect")
        .data(visible)
        .join("rect")
        .attr("x", (b) => barLeft(b))
        .attr("y", (b) => clampY(b.start))
        .attr("width", Math.max(0.5, barWidth))
        .attr("height", (b) => Math.max(1, clampY(b.end) - clampY(b.start)))
        .attr("rx", radius)
        .attr("fill", SLEEP_COLOR);

      const xAxisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
      // Never finer than a day: each bar *is* a day, so over a short range
      // d3's default hour ticks ("06 AM", "12 PM") would label positions
      // inside a single night's slot that mean nothing here.
      const tickCount = Math.max(2, Math.floor(innerWidth / 90));
      const [d0, d1] = x.domain();
      const spanDays = Math.round((d1.getTime() - d0.getTime()) / 86_400_000);
      const xAxis = d3.axisBottom(x);
      if (spanDays <= tickCount) xAxis.ticks(d3.timeDay.every(1)).tickFormat((d) => formatDate(toDateString(d as Date)));
      // Between the two, d3 can still pick a 12-hour interval; keep only
      // the ticks that land on a day boundary.
      else xAxis.tickValues(x.ticks(tickCount).filter((d) => d.getHours() === 0));
      styleAxis(xAxisG, xAxis);

      const yAxisG = g.append("g");
      styleAxis(
        yAxisG,
        d3
          .axisLeft(y)
          .tickValues(ticks)
          .tickFormat((t) => formatAxisClock(Number(t))),
      );
    },
    [visible, x, y, innerWidth, innerHeight, barWidth, dayWidth],
  );

  const hovered = crosshair.point;

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-label="Sleep hours: one bar per night from falling asleep to waking, against a noon-to-noon clock axis."
      />
      {/* Interaction surface kept outside the useD3 svg, so pointer moves
          never trigger a full redraw — see use-d3.ts. */}
      <div
        className="absolute outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ left: MARGIN.left, top: MARGIN.top, width: innerWidth, height: innerHeight }}
        aria-label="Sleep hours by night. Use the left and right arrow keys to step through nights."
        {...crosshair.handlers}
      >
        {hovered ? (
          <div
            className="pointer-events-none absolute rounded-[2px] ring-2 ring-foreground"
            style={{
              left: barLeft(hovered),
              top: clampY(hovered.start),
              width: Math.max(2, barWidth),
              height: Math.max(2, clampY(hovered.end) - clampY(hovered.start)),
            }}
          />
        ) : null}
      </div>
      {hovered && crosshair.pixelX !== null ? (
        <ChartTooltip
          x={MARGIN.left + crosshair.pixelX}
          y={MARGIN.top + (clampY(hovered.start) + clampY(hovered.end)) / 2}
          containerWidth={width}
          title={`Night of ${formatDate(hovered.date, "weekdayYear")}`}
          rows={[
            { label: "asleep", value: formatDuration(hovered.durationMinutes / 60), color: SLEEP_COLOR, variant: "swatch" },
            { label: "Fell asleep", value: formatAxisClock(hovered.start), color: SLEEP_COLOR, noSwatch: true, labelFirst: true },
            { label: "Woke", value: formatAxisClock(hovered.end), color: SLEEP_COLOR, noSwatch: true, labelFirst: true },
          ]}
        />
      ) : null}
    </>
  );
}
