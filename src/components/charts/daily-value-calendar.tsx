"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveCalendar,
  type InteractiveCalendarPoint,
} from "@/components/charts/interactive/interactive-calendar";
import type { DailyValue } from "@/lib/charts";

/**
 * A year-strip heatmap of one value per day — legacy's "calendar" shape,
 * generically.
 *
 * Uses ResponsiveChart's auto-height mode (no `height` prop) for the same
 * reason `SleepCalendarChart` does: a calendar's rendered height depends on
 * the cell size the primitive picks from the *measured* width, which isn't
 * known until after first render, so any height guessed ahead of that can
 * disagree with what gets painted. `min-h-[160px]` only gives the first
 * pre-measurement layout pass something non-zero to report.
 */
export function DailyValueCalendar({
  data,
  formatValue,
  valueLabel,
  ariaLabel,
}: {
  data: DailyValue[];
  formatValue: (value: number) => string;
  valueLabel: string;
  ariaLabel: string;
}) {
  const points = useMemo<InteractiveCalendarPoint[]>(
    () => data.map((d) => ({ date: d.date, value: d.value })),
    [data],
  );

  return (
    <ResponsiveChart minWidth={240} className="min-h-[160px]">
      {({ width }) => (
        <InteractiveCalendar
          points={points}
          width={width}
          formatValue={formatValue}
          valueLabel={valueLabel}
          ariaLabel={ariaLabel}
        />
      )}
    </ResponsiveChart>
  );
}
