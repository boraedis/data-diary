"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveScroller,
  type InteractiveScrollerPoint,
} from "@/components/charts/interactive/interactive-scroller";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { parseDate } from "@/lib/date";
import type { DailyValue } from "@/lib/charts";

/**
 * Legacy's "scroller" shape with controls: every logged day, zoomable, with
 * a selectable rolling-average window.
 *
 * Deliberately no time-range picker, unlike `TrendExplorer`. The scroller
 * already has direct zoom and a minimap brush for exactly that job, and a
 * second range control would fight it — two inputs owning the same piece of
 * state, disagreeing whenever either moves.
 *
 * The window sizes are the tool this chart actually needs instead: the raw
 * daily line is noisy by design, and which smoothing you want depends on
 * whether you're reading a week's shape or a year's.
 */
type WindowId = "none" | "7" | "30" | "90";

const WINDOW_OPTIONS: GroupByOption<WindowId>[] = [
  { id: "none", label: "None" },
  { id: "7", label: "7-day" },
  { id: "30", label: "30-day" },
  { id: "90", label: "90-day" },
];

export function DailyExplorer({
  data,
  title,
  description,
  seriesId,
  label,
  color,
  valueFormat,
  ariaLabel,
}: {
  data: DailyValue[];
  title: string;
  description: string;
  seriesId: string;
  label: string;
  color: string;
  valueFormat: (value: number) => string;
  ariaLabel: string;
}) {
  const [windowId, setWindowId] = useState<WindowId>("30");
  const window = windowId === "none" ? 0 : Number(windowId);

  const points = useMemo<InteractiveScrollerPoint[]>(
    () => data.map((d) => ({ x: parseDate(d.date), y: d.value })),
    [data],
  );

  return (
    <ChartPage
      title={title}
      filters={
        <GroupByPicker
          value={windowId}
          onChange={setWindowId}
          options={WINDOW_OPTIONS}
          label="Rolling average"
        />
      }
    >
      <ChartCard title={title} description={description} empty={points.length === 0}>
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
          {({ width, height }) => (
            <InteractiveScroller
              series={[{ id: seriesId, label, color, points, movingAverage: window > 0 }]}
              movingAverageWindow={window > 0 ? window : undefined}
              width={width}
              height={height}
              valueFormat={valueFormat}
              ariaLabel={ariaLabel}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
