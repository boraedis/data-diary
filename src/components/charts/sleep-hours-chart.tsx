"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { styleAxis } from "@/components/charts/interactive/axis";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { computeRegionDepths, type InteractiveScrollerRegion } from "@/components/charts/interactive/interactive-scroller";
import { Legend, type LegendSeries } from "@/components/charts/interactive/legend";
import { MARK_SPECS } from "@/components/charts/interactive/marks";
import { ChartTooltip, useCrosshair } from "@/components/charts/interactive/tooltip";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import type { DayType } from "@/db/schema";
import { useD3 } from "@/hooks/use-d3";
import { parseDate } from "@/lib/date";
import type { ProfileRegionGroups, SleepNight } from "@/lib/charts";
import { DAY_TYPE_LABELS, DAY_TYPE_ORDER, dayTypeColor } from "@/lib/viz/day-type";
import { formatDate, formatDuration } from "@/lib/viz/format";
import { SLEEP_HOURS_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { SLEEP_HOURS_METHODOLOGY } from "@/lib/viz/methodology";
import { buildSleepBars, clockTicks, fitClockDomain, formatAxisClock, sleepDates, type SleepBar } from "@/lib/viz/sleep-hours";
import { SLEEP_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Sleep Hours (#212) — legacy's `sleeping_hours`: one vertical bar per
// night, from falling asleep to waking, against a clock-time axis, so the
// shape of a year shows *when* sleep happened and not just how long it
// was. A bespoke chart rather than an InteractiveTimeline consumer: a
// Gantt lays out a handful of long, labelled rows on a calendar axis,
// where this is hundreds of short bars on a repeating 24-hour one. The
// axis arithmetic (origin, fitting, ticks, wake dates) is pure, in
// `src/lib/viz/sleep-hours.ts`.
//
// Borrows two things from InteractiveScroller rather than being built on
// it (a scroller plots a value per day as a line; this plots an interval
// per day as a bar): direct wheel-zoom/drag-pan on the plot, and the
// profile's region bands. Both follow that primitive's own implementation
// closely — see its comments for the React-19/d3-zoom pitfalls the zoom
// wiring here sidesteps the same way.

const MARGIN = { top: 12, right: 12, bottom: 28, left: 48 };

const DAY_MS = 86_400_000;

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
 * the latest year, and zooming or the range slider reach back to the
 * start: it's windowed, not aggregated, because averaging nights would
 * erase the night-to-night scatter this chart exists to show (Sleep Trend
 * already does the averaged view).
 */
const DEFAULT_WINDOW_DAYS = 365;

/** Zooming in stops at about a fortnight on screen — past that the bars
 * are already at `MARK_SPECS.bar.maxThickness` and more zoom only adds
 * empty space between them. */
const MIN_VISIBLE_DAYS = 14;

/** Below this bar width the 1px gap between neighbours would eat most of
 * the bar, so bars touch instead and read as a continuous band. */
const GAP_MIN_BAR_WIDTH = 3;

/** Nights logged before day types were (2019, and the odd unlogged day
 * since). Its own legend entry rather than dropped, so the 2019 nights
 * don't silently vanish. Deliberately not `categoricalColor`'s overflow
 * grey — that's already `sick`'s colour — but the same neutral at half
 * strength, so "unknown" reads as quieter than any real type. */
const UNRECORDED_ID = "unrecorded";
const UNRECORDED_COLOR = "color-mix(in oklab, var(--muted-foreground) 45%, transparent)";

const barColor = (dayType: DayType | null) => (dayType ? dayTypeColor(dayType) : UNRECORDED_COLOR);

type RegionType = "none" | "age" | "occupation" | "residence" | "relationship";

// Single-select, same call as every scroller chart's region picker:
// several overlay types stacked at once read as clutter, not correlation.
const REGION_TYPE_OPTIONS: GroupByOption<RegionType>[] = [
  { id: "none", label: "None" },
  { id: "age", label: "Age" },
  { id: "occupation", label: "Occupation" },
  { id: "residence", label: "Residence" },
  { id: "relationship", label: "Relationship" },
];

/** A region's band opacity and label row height — InteractiveScroller's
 * own values, so a region looks the same behind bars as behind a line. */
const REGION_OPACITY = MARK_SPECS.area.fillOpacity;
const REGION_LABEL_ROW_HEIGHT = 14;

type TimedBar = SleepBar & { time: number };

export function SleepHoursChart({ data, regionGroups }: { data: SleepNight[]; regionGroups: ProfileRegionGroups }) {
  const bars = useMemo<TimedBar[]>(
    () => buildSleepBars(data).map((b) => ({ ...b, time: parseDate(b.date).getTime() })),
    [data],
  );

  // The x domain each night's slot lives in: [its date, the next date).
  // So the full domain ends a day after the last night, giving that night
  // a whole bar's width instead of none.
  const fullDomain = useMemo<[Date, Date] | null>(
    () => (bars.length ? [new Date(bars[0].time), new Date(bars[bars.length - 1].time + DAY_MS)] : null),
    [bars],
  );

  const defaultDomain = useMemo<[Date, Date] | null>(() => {
    if (!fullDomain) return null;
    const start = new Date(fullDomain[1].getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    return start > fullDomain[0] ? [start, fullDomain[1]] : fullDomain;
  }, [fullDomain]);

  // `undefined` until the reader touches anything, so the default year can
  // be told apart from a deliberate zoom back out to everything — the
  // same distinction life-timeline-chart.tsx draws.
  const [domain, setDomain] = useState<[Date, Date] | undefined>(undefined);
  const effectiveDomain = domain ?? defaultDomain;

  const [regionType, setRegionType] = useState<RegionType>("none");
  const regions = useMemo(() => (regionType === "none" ? [] : regionGroups[regionType]), [regionType, regionGroups]);

  // Legend: every day type that actually occurs, in the fixed colour order,
  // plus "Not recorded" last when any night lacks one. Click to hide.
  const legendSeries = useMemo<LegendSeries[]>(() => {
    const seen = new Set(bars.map((b) => b.dayType));
    const rows: LegendSeries[] = DAY_TYPE_ORDER.filter((t) => seen.has(t)).map((t) => ({
      id: t,
      label: DAY_TYPE_LABELS[t],
      color: dayTypeColor(t),
    }));
    if (seen.has(null)) rows.push({ id: UNRECORDED_ID, label: "Not recorded", color: UNRECORDED_COLOR });
    return rows;
  }, [bars]);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(() => new Set());
  const shownBars = useMemo(
    () => (hiddenTypes.size ? bars.filter((b) => !hiddenTypes.has(b.dayType ?? UNRECORDED_ID)) : bars),
    [bars, hiddenTypes],
  );

  // The slider speaks in nights (inclusive last night); the chart speaks in
  // slots (exclusive end). Convert at this one boundary.
  const sliderDomain = fullDomain ? ([fullDomain[0], new Date(fullDomain[1].getTime() - DAY_MS)] as [Date, Date]) : null;
  const sliderValue = effectiveDomain
    ? ([effectiveDomain[0], new Date(effectiveDomain[1].getTime() - DAY_MS)] as [Date, Date])
    : null;

  return (
    <ChartPage
      title="Sleep Hours"
      description="One bar per night, from falling asleep at the top to waking at the bottom, coloured by the kind of day it followed. The clock runs noon to noon, so a night that crosses midnight is one unbroken bar."
      info={{
        interactionGuide: SLEEP_HOURS_INTERACTION_GUIDE,
        methodology: SLEEP_HOURS_METHODOLOGY,
        trackingSpan: SLEEP_TRACKING_SPAN,
      }}
      filters={
        <>
          <GroupByPicker value={regionType} onChange={setRegionType} options={REGION_TYPE_OPTIONS} label="Regions" />
          {sliderDomain ? (
            <TimeRangePicker
              domain={sliderDomain}
              value={sliderValue}
              onChange={([start, end]) => setDomain([start, new Date(end.getTime() + DAY_MS)])}
              label="Period"
            />
          ) : null}
        </>
      }
    >
      <ChartCard empty={bars.length === 0}>
        <div className="pb-1.5">
          <Legend
            series={legendSeries}
            hiddenIds={hiddenTypes}
            onToggle={(id) =>
              setHiddenTypes((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        </div>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={320}>
          {({ width, height }) =>
            fullDomain && effectiveDomain ? (
              <SleepHoursPlot
                bars={shownBars}
                regions={regions}
                fullDomain={fullDomain}
                domain={effectiveDomain}
                onDomainChange={setDomain}
                width={width}
                height={height}
              />
            ) : null
          }
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}

function SleepHoursPlot({
  bars,
  regions,
  fullDomain,
  domain,
  onDomainChange,
  width,
  height,
}: {
  bars: TimedBar[];
  regions: InteractiveScrollerRegion[];
  /** Every night's slot, first to last — what zooming out is bounded by. */
  fullDomain: [Date, Date];
  /** The visible x window, exclusive end. Controlled: the range slider and
   * the plot's own zoom/pan are one piece of state. */
  domain: [Date, Date];
  onDomainChange: (domain: [Date, Date]) => void;
  width: number;
  height: number;
}) {
  const clipId = useId().replace(/[:]/g, "");
  const resolvedRegions = useMemo(() => computeRegionDepths(regions), [regions]);

  // Region labels get their own strip above the plot rather than sitting
  // on top of it the way the scroller's do: there, a label lands on empty
  // space above a line, but here the earliest bedtimes run right up to the
  // plot's top edge and a label would be drawn across them.
  const labelRows = resolvedRegions.length ? Math.max(...resolvedRegions.map((r) => r.depth)) + 1 : 0;
  const labelStrip = labelRows * REGION_LABEL_ROW_HEIGHT + (labelRows ? 4 : 0);
  const plotTop = MARGIN.top + labelStrip;

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - plotTop - MARGIN.bottom);

  const d0 = domain[0].getTime();
  const d1 = domain[1].getTime();

  // Every bar whose slot overlaps the window, including one only partly in
  // view at either edge — the clip path trims it, rather than it popping
  // in and out whole as you pan.
  const visible = useMemo(() => bars.filter((b) => b.time + DAY_MS > d0 && b.time < d1), [bars, d0, d1]);

  const x = useMemo(() => d3.scaleTime().domain([new Date(d0), new Date(d1)]).range([0, innerWidth]), [d0, d1, innerWidth]);

  const y = useMemo(
    () => d3.scaleLinear().domain(fitClockDomain(visible)).range([0, innerHeight]),
    [visible, innerHeight],
  );

  const dayWidth = (innerWidth * DAY_MS) / Math.max(DAY_MS, d1 - d0);
  const barWidth = Math.min(MARK_SPECS.bar.maxThickness, dayWidth >= GAP_MIN_BAR_WIDTH ? dayWidth - 1 : dayWidth);

  // `fitClockDomain` trims the extremes over a long range, so the odd bar
  // can run past the plot; it's cut at the edge rather than drawn over the
  // axis, and the tooltip still gives its real times.
  const clampY = (minutes: number) => Math.min(innerHeight, Math.max(0, y(minutes)));

  const barLeft = (b: TimedBar) => x(b.time) + (dayWidth - barWidth) / 2;

  // A bar is centred in its day's slot, so its centre doesn't depend on
  // the bar's own width.
  const centers = useMemo(() => visible.map((b) => x(b.time) + dayWidth / 2), [visible, x, dayWidth]);

  const crosshair = useCrosshair(visible, centers);

  // --- Direct zoom/pan, InteractiveScroller's wiring ----------------------
  //
  // Wheel zooms, drag pans, double-click resets — on the plain overlay div,
  // with d3-zoom rescaling a fixed full-extent base scale. Double-click is
  // a React `onDoubleClick` and d3's own dblclick.zoom binding is removed
  // from the selection, for the React 19 reason InteractiveScroller's
  // comment gives. Programmatic transform syncs (the slider moving) carry
  // no `sourceEvent`, and are ignored so they can't echo back as a state
  // update.
  const overlayRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<{
    behavior: d3.ZoomBehavior<HTMLDivElement, unknown>;
    selection: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  } | null>(null);
  const onDomainChangeRef = useRef(onDomainChange);
  useEffect(() => {
    onDomainChangeRef.current = onDomainChange;
  }, [onDomainChange]);

  const full0 = fullDomain[0].getTime();
  const full1 = fullDomain[1].getTime();

  useEffect(() => {
    const node = overlayRef.current;
    if (!node || innerWidth <= 0) return;
    const baseX = d3.scaleTime().domain([new Date(full0), new Date(full1)]).range([0, innerWidth]);
    const maxScale = Math.max(1, (full1 - full0) / (MIN_VISIBLE_DAYS * DAY_MS));

    const behavior = d3
      .zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, maxScale])
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .translateExtent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .on("zoom", (event: d3.D3ZoomEvent<HTMLDivElement, unknown>) => {
        if (!event.sourceEvent) return;
        const [start, end] = event.transform.rescaleX(baseX).domain() as [Date, Date];
        onDomainChangeRef.current([start, end]);
      });

    const selection = d3.select(node).call(behavior).on("dblclick.zoom", null);
    zoomRef.current = { behavior, selection };
    return () => {
      selection.on(".zoom", null);
      zoomRef.current = null;
    };
  }, [innerWidth, innerHeight, full0, full1]);

  // Keep d3-zoom's own transform matching the controlled domain, so a wheel
  // turn after moving the slider zooms from where the slider left it.
  useEffect(() => {
    if (!zoomRef.current || innerWidth <= 0) return;
    const { behavior, selection } = zoomRef.current;
    const baseX = d3.scaleTime().domain([new Date(full0), new Date(full1)]).range([0, innerWidth]);
    const spanPx = baseX(new Date(d1)) - baseX(new Date(d0));
    if (spanPx <= 0) return;
    const k = innerWidth / spanPx;
    selection.call(behavior.transform, d3.zoomIdentity.translate(-baseX(new Date(d0)) * k, 0).scale(k));
  }, [d0, d1, full0, full1, innerWidth]);

  const svgRef = useD3<SVGSVGElement>(
    (svg) => {
      if (innerWidth <= 0 || innerHeight <= 0) return;
      svg.append("clipPath").attr("id", clipId).append("rect").attr("width", innerWidth).attr("height", innerHeight + labelStrip);

      // The clipped group starts at the top of the label strip so region
      // bands and their labels share one clip with the bars.
      const strip = svg
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`)
        .attr("clip-path", `url(#${clipId})`);
      const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${plotTop})`);

      for (const region of resolvedRegions) {
        const rx0 = Math.max(0, x(region.start));
        const rx1 = Math.min(innerWidth, x(region.end));
        if (rx1 <= rx0) continue;
        const fill = region.color ?? "var(--muted-foreground)";
        strip
          .append("rect")
          .attr("x", rx0)
          .attr("y", labelStrip)
          .attr("width", rx1 - rx0)
          .attr("height", innerHeight)
          .attr("fill", fill)
          .attr("fill-opacity", REGION_OPACITY);
        // A solid tick of the region's colour in its own label row, so a
        // band's extent still reads where the bars cover it.
        const rowY = region.depth * REGION_LABEL_ROW_HEIGHT;
        strip
          .append("rect")
          .attr("x", rx0)
          .attr("y", rowY + REGION_LABEL_ROW_HEIGHT - 3)
          .attr("width", rx1 - rx0)
          .attr("height", 2)
          .attr("fill", fill);
        // Same rough fit test as the scroller's labels (0.6em per char).
        if (rx1 - rx0 - 8 > region.label.length * 11 * 0.6) {
          strip
            .append("text")
            .attr("x", rx0 + 4)
            .attr("y", rowY + REGION_LABEL_ROW_HEIGHT - 5)
            .attr("fill", "var(--muted-foreground)")
            .style("font-size", MARK_SPECS.axis.tickFontSize)
            .text(region.label);
        }
      }

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
        .attr("clip-path", `url(#${clipId})`)
        .selectAll("rect")
        .data(visible)
        .join("rect")
        .attr("x", (b) => barLeft(b))
        .attr("y", (b) => clampY(b.start))
        .attr("width", Math.max(0.5, barWidth))
        .attr("height", (b) => Math.max(1, clampY(b.end) - clampY(b.start)))
        .attr("rx", radius)
        // `style`, not the fill attribute: the unrecorded colour is a
        // `color-mix()`, which is CSS-only.
        .style("fill", (b) => barColor(b.dayType));

      const xAxisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
      // Never finer than a day: each bar *is* a day, so over a short range
      // d3's default hour ticks ("06 AM", "12 PM") would label positions
      // inside a single night's slot that mean nothing here. d3 can still
      // pick a 12-hour interval, so keep only ticks on a day boundary.
      const tickCount = Math.max(2, Math.floor(innerWidth / 90));
      styleAxis(xAxisG, d3.axisBottom(x).tickValues(x.ticks(tickCount).filter((d) => d.getHours() === 0)));

      const yAxisG = g.append("g");
      styleAxis(
        yAxisG,
        d3
          .axisLeft(y)
          .tickValues(ticks)
          .tickFormat((t) => formatAxisClock(Number(t))),
      );
    },
    [visible, resolvedRegions, x, y, innerWidth, innerHeight, labelStrip, plotTop, barWidth, dayWidth, clipId],
  );

  const hovered = crosshair.point;
  const dates = hovered ? sleepDates(hovered) : null;

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-label="Sleep hours: one bar per night from falling asleep to waking, against a noon-to-noon clock axis, coloured by day type."
      />
      {/* Interaction surface kept outside the useD3 svg, so pointer moves
          never trigger a full redraw — see use-d3.ts. */}
      <div
        ref={overlayRef}
        className="absolute outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ left: MARGIN.left, top: plotTop, width: innerWidth, height: innerHeight, cursor: "grab" }}
        aria-label="Sleep hours by night. Scroll to zoom, drag to pan, double-click to show everything. Use the left and right arrow keys to step through nights."
        onDoubleClick={() => onDomainChange(fullDomain)}
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
      {hovered && dates && crosshair.pixelX !== null ? (
        <ChartTooltip
          x={MARGIN.left + crosshair.pixelX}
          y={plotTop + (clampY(hovered.start) + clampY(hovered.end)) / 2}
          containerWidth={width}
          title={`Woke up ${formatDate(dates.woke, "weekdayYear")}`}
          rows={[
            { label: "asleep", value: formatDuration(hovered.durationMinutes / 60), color: "", noSwatch: true },
            {
              label: "Fell asleep",
              // The weekday says which night it was without a second full
              // date — "Sun 23:40" vs "Mon 01:10" is exactly the distinction
              // the noon-to-noon axis hides.
              value: `${formatDate(dates.asleep, "dayName")} ${formatAxisClock(hovered.start)}`,
              color: "",
              noSwatch: true,
              labelFirst: true,
            },
            { label: "Woke up", value: formatAxisClock(hovered.end), color: "", noSwatch: true, labelFirst: true },
            {
              label: `on ${formatDate(hovered.date, "dayName")}`,
              value: hovered.dayType ? DAY_TYPE_LABELS[hovered.dayType] : "Not recorded",
              color: barColor(hovered.dayType),
              variant: "swatch",
            },
          ]}
        />
      ) : null}
    </>
  );
}
