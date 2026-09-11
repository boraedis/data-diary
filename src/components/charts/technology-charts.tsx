"use client";

import { useMemo } from "react";
import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import {
  CompositionExplorer,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveScroller,
  type InteractiveScrollerPoint,
  type InteractiveScrollerSeries,
} from "@/components/charts/interactive/interactive-scroller";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import { parseDate } from "@/lib/date";
import type { DailyValue, DeviceDay } from "@/lib/charts";
import { SCROLLER_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import {
  INSTAGRAM_METHODOLOGY,
  SCREEN_TIME_METHODOLOGY,
} from "@/lib/viz/methodology";
import { INSTAGRAM_TRACKING_SPAN, SCREEN_TIME_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

const PHONE = "Phone";
const LAPTOP = "Laptop";
const INSTAGRAM = "Instagram";

// Fixed slots, assigned here rather than by array position, so the two
// devices keep their colours across all three charts below — the same
// "colour follows the entity" rule the composition explorer applies within
// a single chart, extended across a set of them.
const DEVICE_COLORS: Record<string, string> = {
  [PHONE]: categoricalColor(0),
  [LAPTOP]: categoricalColor(2),
  [INSTAGRAM]: categoricalColor(1),
};

const DEVICE_CATEGORIES = [
  { id: PHONE, label: PHONE, color: DEVICE_COLORS[PHONE] },
  { id: LAPTOP, label: LAPTOP, color: DEVICE_COLORS[LAPTOP] },
];

const asHours = (minutes: number) => minutes / 60;
const formatHours = (hours: number) => formatDuration(hours);

/**
 * Screen time split by device, over time.
 *
 * A stacked area rather than two lines: the interesting question is the
 * balance between the two as much as either total, and share mode answers
 * it directly. Two categories also sit comfortably inside the palette, so
 * nothing folds.
 *
 * Instagram usage deliberately isn't a third category here (#326) — it's a
 * *subset* of Phone, not an independent total, and a stacked/share chart
 * would double-count it against Phone if it were. It gets its own line
 * on the daily scroller below instead, where three independently
 * toggleable lines can overlap without implying a sum.
 */
export function DeviceUsageChart({ data }: { data: DeviceDay[] }) {
  const rows = useMemo<CompositionRow[]>(
    () =>
      data.map((day) => ({
        date: day.date,
        values: {
          [PHONE]: asHours(day.phoneMinutes ?? 0),
          [LAPTOP]: asHours(day.laptopMinutes ?? 0),
        },
      })),
    [data],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={DEVICE_CATEGORIES}
      title="Screen Time Mix"
      description="A breakdown of phone vs. laptop usage, aggregated by period."
      methodology={SCREEN_TIME_METHODOLOGY}
      trackingSpan={SCREEN_TIME_TRACKING_SPAN}
      valueFormat={formatHours}
      ariaLabel="Time spent on phone and laptop over time."
    />
  );
}

/**
 * Every logged day's screen time, zoomable — phone, laptop, and Instagram
 * as three simultaneous lines (#326), rather than a single-select picker.
 * Unlike the mix/calendar charts above, nothing here is stacked or summed,
 * so Instagram overlapping inside Phone's own line isn't a double-counting
 * problem — it's just two lines that happen to move together. The shared
 * legend (`InteractiveScroller`'s own, click-to-toggle) is how you isolate
 * one line or compare two, rather than a separate device-picker control.
 */
export function DeviceDailyChart({ data }: { data: DeviceDay[] }) {
  const series = useMemo<InteractiveScrollerSeries[]>(() => {
    const toPoints = (pick: (day: DeviceDay) => number | null): InteractiveScrollerPoint[] =>
      data
        .filter((day) => pick(day) !== null)
        .map((day) => ({ x: parseDate(day.date), y: asHours(pick(day) as number) }));

    return [
      { id: "phone", label: PHONE, color: DEVICE_COLORS[PHONE], movingAverage: true, points: toPoints((d) => d.phoneMinutes) },
      { id: "laptop", label: LAPTOP, color: DEVICE_COLORS[LAPTOP], movingAverage: true, points: toPoints((d) => d.laptopMinutes) },
      { id: "instagram", label: INSTAGRAM, color: DEVICE_COLORS[INSTAGRAM], movingAverage: true, points: toPoints((d) => d.instagramMinutes) },
    ];
  }, [data]);

  return (
    <ChartPage
      title="Daily Screen Time"
      description="A day-by-day look at phone, laptop, and Instagram usage. Use the legend to isolate or compare lines."
      info={{
        interactionGuide: SCROLLER_INTERACTION_GUIDE,
        methodology: SCREEN_TIME_METHODOLOGY,
        trackingSpan: SCREEN_TIME_TRACKING_SPAN,
      }}
      filters={null}
    >
      <ChartCard empty={series.every((s) => s.points.length === 0)}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveScroller
              series={series}
              width={width}
              height={height}
              valueFormat={formatHours}
              ariaLabel="Daily screen time. Phone, laptop, and Instagram usage as three lines; use the legend to hide any of them. Scroll or pinch to zoom, drag to pan, hover a day for its exact totals."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}

/**
 * One calendar for both devices, per the note on #209 that they belong
 * together rather than as two near-identical grids.
 *
 * Uses the blended-cell mode (#210) with **weights**: the hue leans toward
 * whichever device the day actually went on, and the cell's intensity
 * carries the combined total. So a heavy laptop day and a heavy phone day
 * are different colours at similar strength, and a quiet day of either is
 * faint — which is exactly the pair of questions two separate calendars
 * would have made you answer by flicking between them. Instagram isn't a
 * third category here for the same reason it isn't on the mix chart above
 * — see `DeviceUsageChart`'s own comment.
 */
export function DeviceCalendarChart({ data }: { data: DeviceDay[] }) {
  const points = useMemo(
    () =>
      data.map((day) => {
        const phone = day.phoneMinutes ?? 0;
        const laptop = day.laptopMinutes ?? 0;
        const categories = [
          { label: PHONE, color: DEVICE_COLORS[PHONE], weight: phone },
          { label: LAPTOP, color: DEVICE_COLORS[LAPTOP], weight: laptop },
          // A zero-weight category is dropped by the blend, so a
          // single-device day reads as that device's own colour rather
          // than a mix pulled halfway toward one that wasn't used.
        ].filter((c) => c.weight > 0);
        return { date: day.date, value: asHours(phone + laptop), categories };
      }),
    [data],
  );

  return (
    <CalendarExplorer
      data={points}
      title="Screen Time Calendar"
      description="Both devices on one grid: colour leans toward whichever you used more, strength shows the combined total."
      methodology={SCREEN_TIME_METHODOLOGY}
      trackingSpan={SCREEN_TIME_TRACKING_SPAN}
      formatValue={formatHours}
      valueLabel="screen time"
      ariaLabel="Calendar of daily screen time, coloured by which device dominated and shaded by the total."
    />
  );
}

/**
 * Instagram followers over time.
 *
 * Rolling average off by default: the series is cumulative, so smoothing a
 * line that only ever rises says nothing the line doesn't already. It stays
 * available for anyone who wants to read the rate of change rather than the
 * level.
 */
export function InstagramFollowersChart({ data }: { data: DailyValue[] }) {
  return (
    <DailyExplorer
      data={data}
      title="Instagram Followers"
      description="A day-by-day look at Instagram followers. A running total, so it only moves when it moves."
      methodology={INSTAGRAM_METHODOLOGY}
      trackingSpan={INSTAGRAM_TRACKING_SPAN}
      seriesId="followers"
      label="Followers"
      color={categoricalColor(3)}
      valueFormat={(v) => Math.round(v).toLocaleString()}
      initialWindow={0}
      ariaLabel="Instagram follower count over time. Scroll or pinch to zoom, drag to pan."
    />
  );
}
