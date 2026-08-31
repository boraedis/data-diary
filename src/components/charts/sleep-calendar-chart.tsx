"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveCalendar,
  type InteractiveCalendarPoint,
} from "@/components/charts/interactive/interactive-calendar";
import type { SleepDay } from "@/lib/charts";

/** GitHub-style calendar heatmap of sleep duration, one strip per year —
 * the legacy app's `Calendar`/`MultiCalendar` pattern (functions/views/vis/
 * charts/sleep_calendar.js). A thin wrapper around the shared
 * InteractiveCalendar primitive (#21); cell size still scales down as more
 * years' worth of data comes in, so a multi-decade history stays a fixed
 * width instead of scrolling horizontally forever.
 *
 * Uses ResponsiveChart's auto-height mode (no `height` prop) rather than a
 * pre-measurement height guess: a calendar's real rendered height depends
 * on the cell size InteractiveCalendar picks from the *measured* width,
 * which isn't known until after first render, so any height guessed ahead
 * of that measurement can disagree with what actually gets painted —
 * which is exactly what caused the previous version to overflow its
 * container's height on desktop. `min-h-[160px]` just gives the very
 * first (pre-measurement) layout pass a non-zero starting height for
 * ResizeObserver to report on; InteractiveCalendar's own content is what
 * determines the real height from there. */
export function SleepCalendarChart({ data }: { data: SleepDay[] }) {
  const points = useMemo<InteractiveCalendarPoint[]>(
    () => data.map((d) => ({ date: d.date, value: d.durationMinutes })),
    [data],
  );

  return (
    <ResponsiveChart minWidth={240} className="min-h-[160px]">
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
