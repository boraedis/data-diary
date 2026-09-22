"use client";

import { useMemo, useState } from "react";
import { interpolateRdYlBu } from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveCalendar,
  type InteractiveCalendarPoint,
} from "@/components/charts/interactive/interactive-calendar";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { CALENDAR_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { SLEEP_METHODOLOGY } from "@/lib/viz/methodology";
import { SLEEP_TRACKING_SPAN } from "@/lib/viz/tracking-span";
import type { SleepDay } from "@/lib/charts";

/** GitHub-style calendar heatmap of sleep duration, one strip per year —
 * the legacy app's `Calendar`/`MultiCalendar` pattern (functions/views/vis/
 * charts/sleep_calendar.js). A thin wrapper around the shared
 * InteractiveCalendar primitive (#21); cell size still scales down as more
 * years' worth of data comes in, so a multi-decade history stays a fixed
 * width instead of scrolling horizontally forever.
 *
 * Owns its own page shell (ChartPage + filters + card), the same reason
 * DailyExplorer/TrendExplorer do: the naps toggle below and the chart share
 * client state, and only plain data can cross the server/client boundary —
 * see sleep-daily/page.tsx's comment on the same pattern. Both the private
 * `/charts/sleep` page and the public `/public-charts/sleep` page render
 * this component; `backHref`/`backLabel` are how they differ.
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

/**
 * Legacy's own sleep calendar (functions/views/vis/charts/sleep_calendar.js)
 * colored every cell with `d3.scaleSequential(d3.extent(values),
 * d3.interpolateRdYlBu)` — red for the shortest nights on record, blue for
 * the longest, straight off the raw data's own min/max, no fixed baseline.
 *
 * Two earlier passes at this (this app's own warm/cool diverging pair, then
 * that same pair with a gold accent at a fixed 8h-target midpoint instead
 * of a plain gray one) both still read as nothing like the original once
 * actually seen rendered — a branded, muted reinterpretation isn't what
 * "replicate legacy" meant. This uses `d3.interpolateRdYlBu` directly, via
 * `InteractiveCalendar`'s `colorInterpolator` escape hatch, over the data's
 * own extent rather than a fixed target — i.e. the actual legacy behavior,
 * not an app-branded stand-in for it. See that prop's own doc comment for
 * why this bypasses the app's normal colorblind-validated palette system
 * (viz/color.ts) rather than extending it: this is a deliberate one-off
 * matching a specific remembered look, not a new default worth branding.
 */

type SleepMetric = "sleep" | "sleepPlusNaps";

const METRIC_OPTIONS: GroupByOption<SleepMetric>[] = [
  { id: "sleep", label: "Sleep" },
  { id: "sleepPlusNaps", label: "Sleep + Naps" },
];

export type SleepCalendarPoint = SleepDay & { napMinutes?: number | null };

export function SleepCalendarChart({
  data,
  backHref,
  backLabel,
}: {
  data: SleepCalendarPoint[];
  backHref?: string;
  backLabel?: string;
}) {
  // Only offered where there's actually nap data behind it — most callers
  // (and the entire public site, which never fetches napMinutes at all)
  // have none, and a toggle with no effect is worse than no toggle.
  const hasNaps = useMemo(() => data.some((d) => (d.napMinutes ?? 0) > 0), [data]);
  const [metric, setMetric] = useState<SleepMetric>("sleep");
  const effectiveMetric = hasNaps ? metric : "sleep";

  const points = useMemo<InteractiveCalendarPoint[]>(
    () =>
      data.map((d) => ({
        date: d.date,
        value: d.durationMinutes + (effectiveMetric === "sleepPlusNaps" ? (d.napMinutes ?? 0) : 0),
      })),
    [data, effectiveMetric],
  );

  return (
    <ChartPage
      title="Sleep Calendar"
      description="Nightly sleep duration — red for the shortest nights, blue for the longest."
      info={{
        interactionGuide: CALENDAR_INTERACTION_GUIDE,
        methodology: SLEEP_METHODOLOGY,
        trackingSpan: SLEEP_TRACKING_SPAN,
      }}
      backHref={backHref}
      backLabel={backLabel}
      filters={
        hasNaps ? (
          <GroupByPicker value={effectiveMetric} onChange={setMetric} options={METRIC_OPTIONS} label="Measure" />
        ) : null
      }
    >
      <ChartCard empty={data.length === 0}>
        <ResponsiveChart minWidth={240} className="min-h-[160px]">
          {({ width }) => (
            <InteractiveCalendar
              points={points}
              width={width}
              formatValue={(minutes) => `${(minutes / 60).toFixed(1)}h`}
              valueLabel={effectiveMetric === "sleepPlusNaps" ? "sleep + naps" : "sleep"}
              colorInterpolator={interpolateRdYlBu}
              ariaLabel="Sleep calendar heatmap. Hover a day to see how long you slept."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
