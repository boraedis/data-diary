"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveScroller,
  type InteractiveScrollerSeries,
} from "@/components/charts/interactive/interactive-scroller";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { parseDate } from "@/lib/date";
import type { DailyValue } from "@/lib/charts";
import { SCROLLER_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import type { TrackingSpan } from "@/lib/viz/tracking-span";

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

/** One named line on a `DailyExplorer` chart — usually just one (a coffee
 * count, a sleep duration), but a chart tracking two related running totals
 * (Instagram followers/following, #331) passes more than one so they share
 * one x-axis, zoom, and rolling-average window instead of two side-by-side
 * charts a reader has to line up by eye. */
export type DailyExplorerSeries = { id: string; label: string; color: string; data: DailyValue[] };

export function DailyExplorer({
  series,
  title,
  description,
  methodology,
  trackingSpan,
  valueFormat,
  extraFilters,
  initialWindow = 30,
  ariaLabel,
}: {
  series: DailyExplorerSeries[];
  title: string;
  description: string;
  /** Per-chart methodology copy for the `ChartInfo` popup — see #316.
   * Falls back to a visible placeholder when omitted. */
  methodology?: string;
  /** Per-field "tracked since" copy for the `ChartInfo` popup. Falls back
   * to a visible placeholder when omitted. */
  trackingSpan?: TrackingSpan;
  /** Shared across every series — this chart is one column read at
   * different times/counts, not unrelated units needing their own format. */
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

  const scrollerSeries = useMemo<InteractiveScrollerSeries[]>(
    () =>
      series.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        points: s.data.map((d) => ({ x: parseDate(d.date), y: d.value })),
        movingAverage: window > 0,
      })),
    [series, window],
  );

  return (
    <ChartPage
      title={title}
      description={description}
      info={{ interactionGuide: SCROLLER_INTERACTION_GUIDE, methodology, trackingSpan }}
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
      <ChartCard empty={scrollerSeries.every((s) => s.points.length === 0)}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveScroller
              series={scrollerSeries}
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
