"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveScroller,
  type InteractiveScrollerPoint,
} from "@/components/charts/interactive/interactive-scroller";
import { parseDate } from "@/lib/date";
import type { DailyValue } from "@/lib/charts";

/**
 * Raw daily values with zoom, pan and a synced minimap — legacy's
 * "scroller" shape, generically.
 *
 * The counterpart to `MonthlyAverageChart`: same column, no bucketing.
 * That pairing is deliberate throughout the legacy inventory (#209) and
 * worth keeping — the averager answers "what's the trend", the scroller
 * answers "what actually happened on the 14th", and collapsing them into
 * one chart loses one of those.
 */
export function DailyValueScroller({
  data,
  seriesId,
  label,
  color,
  valueFormat,
  movingAverageWindow = 30,
  ariaLabel,
}: {
  data: DailyValue[];
  seriesId: string;
  label: string;
  color: string;
  valueFormat: (value: number) => string;
  /** Days in the rolling-average overlay. 30 reads as "about a month" on a
   * daily series; pass 0 to leave it off. */
  movingAverageWindow?: number;
  ariaLabel: string;
}) {
  const points = useMemo<InteractiveScrollerPoint[]>(
    () => data.map((d) => ({ x: parseDate(d.date), y: d.value })),
    [data],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveScroller
          series={[{ id: seriesId, label, color, points, movingAverage: movingAverageWindow > 0 }]}
          movingAverageWindow={movingAverageWindow}
          width={width}
          height={height}
          valueFormat={valueFormat}
          ariaLabel={ariaLabel}
        />
      )}
    </ResponsiveChart>
  );
}
