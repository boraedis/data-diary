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
import {
  INSTAGRAM_METHODOLOGY,
  SCREEN_TIME_METHODOLOGY,
} from "@/lib/viz/methodology";
import {
  INSTAGRAM_TRACKING_SPAN,
  INSTAGRAM_USAGE_TRACKING_SPAN,
  SCREEN_TIME_TRACKING_SPAN,
} from "@/lib/viz/tracking-span";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

const PHONE = "Phone";
const LAPTOP = "Laptop";
const INSTAGRAM = "Instagram";

// Fixed slots, assigned here rather than by array position, so the
// devices keep their colours across all three charts below — the same
// "colour follows the entity" rule the composition explorer applies within
// a single chart, extended across a set of them.
const DEVICE_COLORS: Record<string, string> = {
  [PHONE]: categoricalColor(0),
  [LAPTOP]: categoricalColor(2),
  [INSTAGRAM]: categoricalColor(1),
};

/** Instagram usage is a *subset* of phone usage, not an independent total
 * (#326) — stacking it as a third sibling category alongside Phone would
 * double-count minutes already counted in Phone. Every chart below instead
 * splits Phone into "Phone" (non-Instagram) and "Instagram", which still
 * sums to the same phone total. Days before Instagram tracking started
 * (`instagramMinutes === null`) put all their phone time under "Phone"
 * unsplit, so the new category never appears retroactively on history
 * where it simply wasn't tracked. */
function splitPhoneMinutes(day: DeviceDay): { phone: number; instagram: number } {
  const phone = day.phoneMinutes ?? 0;
  const instagram = day.instagramMinutes ?? 0;
  return { phone: phone - instagram, instagram };
}

const DEVICE_CATEGORIES = [
  { id: PHONE, label: PHONE, color: DEVICE_COLORS[PHONE] },
  { id: INSTAGRAM, label: INSTAGRAM, color: DEVICE_COLORS[INSTAGRAM] },
  { id: LAPTOP, label: LAPTOP, color: DEVICE_COLORS[LAPTOP] },
];

const asHours = (minutes: number) => minutes / 60;
const formatHours = (hours: number) => formatDuration(hours);

/**
 * Screen time split by device, over time.
 *
 * A stacked area rather than separate lines: the interesting question is
 * the balance between them as much as any one total, and share mode
 * answers it directly. Instagram is broken out of Phone rather than
 * stacked alongside it — see `splitPhoneMinutes`.
 */
export function DeviceUsageChart({ data }: { data: DeviceDay[] }) {
  const rows = useMemo<CompositionRow[]>(
    () =>
      data.map((day) => {
        const { phone, instagram } = splitPhoneMinutes(day);
        return {
          date: day.date,
          values: {
            [PHONE]: asHours(phone),
            [INSTAGRAM]: asHours(instagram),
            [LAPTOP]: asHours(day.laptopMinutes ?? 0),
          },
        };
      }),
    [data],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={DEVICE_CATEGORIES}
      title="Screen Time Mix"
      description="A breakdown of phone, Instagram, and laptop usage, aggregated by period."
      methodology={SCREEN_TIME_METHODOLOGY}
      trackingSpan={SCREEN_TIME_TRACKING_SPAN}
      valueFormat={formatHours}
      ariaLabel="Time spent on phone, Instagram, and laptop over time."
    />
  );
}

type DeviceChoice = "total" | typeof PHONE | typeof LAPTOP | typeof INSTAGRAM;

const DEVICE_OPTIONS: GroupByOption<DeviceChoice>[] = [
  { id: "total", label: "Both" },
  { id: PHONE, label: PHONE },
  { id: LAPTOP, label: LAPTOP },
  { id: INSTAGRAM, label: INSTAGRAM },
];

/** Every logged day's screen time, zoomable, for one device, Instagram, or
 * both devices combined. "Both" stays phone + laptop, unaffected by the
 * Instagram split — Instagram is already inside that phone figure. */
export function DeviceDailyChart({ data }: { data: DeviceDay[] }) {
  const [device, setDevice] = useState<DeviceChoice>("total");

  const points = useMemo(
    () =>
      data.map((day) => {
        const phone = day.phoneMinutes ?? 0;
        const laptop = day.laptopMinutes ?? 0;
        const minutes =
          device === PHONE
            ? phone
            : device === LAPTOP
              ? laptop
              : device === INSTAGRAM
                ? (day.instagramMinutes ?? 0)
                : phone + laptop;
        return { date: day.date, value: asHours(minutes) };
      }),
    [data, device],
  );

  return (
    <DailyExplorer
      data={points}
      title="Daily Screen Time"
      description="A day-by-day look at screen time. Scroll or drag to zoom, and use the strip below to move through the range."
      methodology={SCREEN_TIME_METHODOLOGY}
      trackingSpan={device === INSTAGRAM ? INSTAGRAM_USAGE_TRACKING_SPAN : SCREEN_TIME_TRACKING_SPAN}
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
 * whichever device (or Instagram) the day actually went on, and the cell's
 * intensity carries the combined total. So a heavy laptop day and a heavy
 * Instagram day are different colours at similar strength, and a quiet day
 * is faint — which is exactly the pair of questions separate calendars
 * would have made you answer by flicking between them. Instagram is broken
 * out of Phone rather than stacked alongside it — see `splitPhoneMinutes`
 * — so the cell's total (phone + laptop) is unaffected by the split.
 */
export function DeviceCalendarChart({ data }: { data: DeviceDay[] }) {
  const points = useMemo(
    () =>
      data.map((day) => {
        const { phone, instagram } = splitPhoneMinutes(day);
        const laptop = day.laptopMinutes ?? 0;
        const categories = [
          { label: PHONE, color: DEVICE_COLORS[PHONE], weight: phone },
          { label: INSTAGRAM, color: DEVICE_COLORS[INSTAGRAM], weight: instagram },
          { label: LAPTOP, color: DEVICE_COLORS[LAPTOP], weight: laptop },
          // A zero-weight category is dropped by the blend, so a
          // single-device day (or a day before Instagram was tracked)
          // reads as that device's own colour rather than a mix pulled
          // halfway toward one that wasn't used.
        ].filter((c) => c.weight > 0);
        return { date: day.date, value: asHours(phone + instagram + laptop), categories };
      }),
    [data],
  );

  return (
    <CalendarExplorer
      data={points}
      title="Screen Time Calendar"
      description="Phone, Instagram, and laptop on one grid: colour leans toward whichever you used most, strength shows the combined total."
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
