"use client";

import { useMemo, useState } from "react";
import { CalendarExplorer, type CalendarDay } from "@/components/charts/calendar-explorer";
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
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
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

type DeviceMetric = "total" | "phone" | "laptop" | "instagram";

const DEVICE_METRIC_OPTIONS: GroupByOption<DeviceMetric>[] = [
  { id: "total", label: "Total" },
  { id: "phone", label: PHONE },
  { id: "laptop", label: LAPTOP },
  { id: "instagram", label: INSTAGRAM },
];

const DEVICE_METRIC_LABELS: Record<DeviceMetric, string> = {
  total: "screen time",
  phone: "phone usage",
  laptop: "laptop usage",
  instagram: "Instagram usage",
};

/**
 * One calendar, switchable between phone, laptop, Instagram, and their
 * combined total (#333) — a `GroupByPicker` "Measure" control, the same
 * pattern `SleepCalendarChart` uses for its own metric switch, rather than
 * the earlier always-blended phone+laptop view: blending baked in exactly
 * two categories, with no room for Instagram (a third, narrower-tracked
 * metric) or a way to isolate a single device's own trend.
 *
 * Each metric only plots the days it actually has data for — Instagram
 * wasn't tracked at all before 2025, and a day can log one device without
 * the other — rather than filling the gaps with zeros, which would read as
 * "no usage" instead of "not recorded".
 */
export function DeviceCalendarChart({ data }: { data: DeviceDay[] }) {
  const [metric, setMetric] = useState<DeviceMetric>("total");

  const points = useMemo<CalendarDay[]>(() => {
    const pick = (day: DeviceDay): number | null => {
      switch (metric) {
        case "phone":
          return day.phoneMinutes;
        case "laptop":
          return day.laptopMinutes;
        case "instagram":
          return day.instagramMinutes;
        case "total":
          return day.phoneMinutes === null && day.laptopMinutes === null
            ? null
            : (day.phoneMinutes ?? 0) + (day.laptopMinutes ?? 0);
      }
    };
    return data
      .filter((day) => pick(day) !== null)
      .map((day) => ({ date: day.date, value: asHours(pick(day) as number) }));
  }, [data, metric]);

  const valueLabel = DEVICE_METRIC_LABELS[metric];

  return (
    <CalendarExplorer
      data={points}
      title="Screen Time Calendar"
      description="Phone, laptop, Instagram, or their combined total — pick a measure below."
      methodology={SCREEN_TIME_METHODOLOGY}
      trackingSpan={SCREEN_TIME_TRACKING_SPAN}
      formatValue={formatHours}
      valueLabel={valueLabel}
      extraFilters={
        <GroupByPicker value={metric} onChange={setMetric} options={DEVICE_METRIC_OPTIONS} label="Measure" />
      }
      ariaLabel={`Calendar of daily ${valueLabel}.`}
    />
  );
}

// The legacy app's own two Instagram colors, kept verbatim rather than
// pulled from the categorical palette (#331) — followers/following are the
// same two lines readers already associate with these exact hues from years
// of the old chart.
const INSTAGRAM_FOLLOWERS_COLOR = "#C13584";
const INSTAGRAM_FOLLOWING_COLOR = "#5B51D8";

/**
 * Instagram followers and following over time.
 *
 * Rolling average off by default: both series are cumulative, so smoothing
 * a line that only ever rises (or, for following, occasionally falls in
 * small steps) says nothing the line doesn't already. It stays available
 * for anyone who wants to read the rate of change rather than the level.
 */
export function InstagramFollowersChart({
  followers,
  following,
}: {
  followers: DailyValue[];
  following: DailyValue[];
}) {
  return (
    <DailyExplorer
      series={[
        { id: "followers", label: "Followers", color: INSTAGRAM_FOLLOWERS_COLOR, data: followers },
        { id: "following", label: "Following", color: INSTAGRAM_FOLLOWING_COLOR, data: following },
      ]}
      title="Instagram Followers"
      description="A day-by-day look at Instagram followers and following. Both are running totals, so they only move when they move."
      methodology={INSTAGRAM_METHODOLOGY}
      trackingSpan={INSTAGRAM_TRACKING_SPAN}
      valueFormat={(v) => Math.round(v).toLocaleString()}
      initialWindow={0}
      ariaLabel="Instagram follower and following counts over time. Scroll or pinch to zoom, drag to pan."
    />
  );
}
