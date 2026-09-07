"use client";

import { useMemo, useState } from "react";
import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import {
  CompositionExplorer,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import type { DailyValue, DeviceDay } from "@/lib/charts";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

const PHONE = "Phone";
const LAPTOP = "Laptop";

// Fixed slots, assigned here rather than by array position, so the two
// devices keep their colours across all three charts below — the same
// "colour follows the entity" rule the composition explorer applies within
// a single chart, extended across a set of them.
const DEVICE_COLORS: Record<string, string> = {
  [PHONE]: categoricalColor(0),
  [LAPTOP]: categoricalColor(2),
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
      title="Screen time"
      description="Time on phone and laptop. Share mode shows how the balance between them has shifted."
      valueFormat={formatHours}
      ariaLabel="Time spent on phone and laptop over time."
    />
  );
}

type DeviceChoice = "total" | typeof PHONE | typeof LAPTOP;

const DEVICE_OPTIONS: GroupByOption<DeviceChoice>[] = [
  { id: "total", label: "Both" },
  { id: PHONE, label: PHONE },
  { id: LAPTOP, label: LAPTOP },
];

/** Every logged day's screen time, zoomable, for one device or both. */
export function DeviceDailyChart({ data }: { data: DeviceDay[] }) {
  const [device, setDevice] = useState<DeviceChoice>("total");

  const points = useMemo(
    () =>
      data.map((day) => {
        const phone = day.phoneMinutes ?? 0;
        const laptop = day.laptopMinutes ?? 0;
        const minutes = device === PHONE ? phone : device === LAPTOP ? laptop : phone + laptop;
        return { date: day.date, value: asHours(minutes) };
      }),
    [data, device],
  );

  return (
    <DailyExplorer
      data={points}
      title="Daily screen time"
      description="Every logged day. Scroll or drag to zoom, and use the strip below to move through the range."
      seriesId="screen-time"
      label={device === "total" ? "Screen time" : device}
      color={device === "total" ? categoricalColor(4) : DEVICE_COLORS[device]}
      valueFormat={formatHours}
      extraFilters={
        <GroupByPicker value={device} onChange={setDevice} options={DEVICE_OPTIONS} label="Device" />
      }
      ariaLabel="Daily screen time. Scroll or pinch to zoom, drag to pan, hover a day for its exact total."
    />
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
 * would have made you answer by flicking between them.
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
      title="Screen time calendar"
      description="Both devices on one grid: colour leans toward whichever you used more, strength shows the combined total."
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
      title="Instagram followers"
      description="Follower count over time. A running total, so it only moves when it moves."
      seriesId="followers"
      label="Followers"
      color={categoricalColor(3)}
      valueFormat={(v) => Math.round(v).toLocaleString()}
      initialWindow={0}
      ariaLabel="Instagram follower count over time. Scroll or pinch to zoom, drag to pan."
    />
  );
}
