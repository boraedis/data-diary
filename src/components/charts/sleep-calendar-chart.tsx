"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveCalendar,
  estimateCalendarHeight,
  type InteractiveCalendarPoint,
} from "@/components/charts/interactive/interactive-calendar";
import type { SleepDay } from "@/lib/charts";

/** GitHub-style calendar heatmap of sleep duration, one strip per year —
 * the legacy app's `Calendar`/`MultiCalendar` pattern (functions/views/vis/
 * charts/sleep_calendar.js). Now a thin wrapper around the shared
 * InteractiveCalendar primitive (#21) instead of its own bespoke
 * implementation; cell size still scales down as more years' worth of
 * data comes in, so a multi-decade history stays a fixed width instead of
 * scrolling horizontally forever. */
export function SleepCalendarChart({ data }: { data: SleepDay[] }) {
  const points = useMemo<InteractiveCalendarPoint[]>(
    () => data.map((d) => ({ date: d.date, value: d.durationMinutes })),
    [data],
  );

  const yearCount = useMemo(() => new Set(data.map((d) => d.date.slice(0, 4))).size, [data]);

  return (
    <ResponsiveChart height={estimateCalendarHeight(yearCount)} minWidth={320}>
      {({ width }) => (
        <InteractiveCalendar
          points={points}
          width={width}
          formatValue={(minutes) => `${(minutes / 60).toFixed(1)}h`}
          valueLabel="sleep"
          ariaLabel="Sleep calendar heatmap. Hover a day to see how long you slept."
        />
      )}
    </ResponsiveChart>
  );
}
