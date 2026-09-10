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
import { SCROLLER_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

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
  methodology,
  seriesId,
  label,
  color,
  valueFormat,
  extraFilters,
  initialWindow = 30,
  ariaLabel,
}: {
  data: DailyValue[];
  title: string;
  description: string;
  /** Per-chart methodology copy for the `ChartInfo` popup — see #316.
   * Falls back to a visible placeholder when omitted. */
  methodology?: string;
  seriesId: string;
  label: string;
  color: string;
  valueFormat: (value: number) => string;
  /** Extra controls rendered before the window picker. The caller owns
   * their state and reshapes `data` accordingly. */
  extraFilters?: React.ReactNode;
  /** Starting rolling-average window in days, or 0 for none. A cumulative
   * series (a follower count, say) wants none — smoothing a line that only
   * ever rises says nothing the line doesn't. */
  initialWindow?: number;
  ariaLabel: string;
}) {
  const [windowId, setWindowId] = useState<WindowId>(
    initialWindow === 0 ? "none" : (String(initialWindow) as WindowId),
  );
  const window = windowId === "none" ? 0 : Number(windowId);

  const points = useMemo<InteractiveScrollerPoint[]>(
    () => data.map((d) => ({ x: parseDate(d.date), y: d.value })),
    [data],
  );

  return (
    <ChartPage
      title={title}
      description={description}
      info={{ interactionGuide: SCROLLER_INTERACTION_GUIDE, methodology }}
      filters={
        <>
          {extraFilters}
          <GroupByPicker
          value={windowId}
          onChange={setWindowId}
          options={WINDOW_OPTIONS}
            label="Rolling average"
          />
        </>
      }
    >
      <ChartCard empty={points.length === 0}>
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
