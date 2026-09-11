"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveCalendar,
  type InteractiveCalendarPoint,
} from "@/components/charts/interactive/interactive-calendar";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { parseDate } from "@/lib/date";
import type { DailyValue } from "@/lib/charts";
import { CALENDAR_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import type { TrackingSpan } from "@/lib/viz/tracking-span";

/** A `DailyValue` optionally carrying the categories that made up the day,
 * which the primitive blends into one cell colour. */
export type CalendarDay = DailyValue & {
  categories?: { label: string; color: string; weight?: number }[];
};

/**
 * Legacy's "calendar" shape with a range control.
 *
 * A year range is the only filter a calendar genuinely wants: it draws one
 * strip per year, so a long history is a lot of vertical scrolling, and
 * narrowing the years is how you actually read a particular stretch. There
 * is no bucket size to pick — the bucket is a day, by definition.
 *
 * Auto-height mode (no `height` prop), same as `SleepCalendarChart`: the
 * rendered height depends on the cell size the primitive derives from the
 * *measured* width, so any height guessed before measurement can disagree
 * with what gets painted.
 */
export function CalendarExplorer({
  data,
  title,
  description,
  methodology,
  trackingSpan,
  formatValue,
  valueLabel,
  extraFilters,
  ariaLabel,
}: {
  /** Days to draw. A day may carry a `categories` breakdown, in which case
   * the primitive blends those colours for that cell instead of using the
   * sequential ramp — see `InteractiveCalendarPoint`. */
  data: CalendarDay[];
  title: string;
  description: string;
  /** Per-chart methodology copy for the `ChartInfo` popup — see #316.
   * Falls back to a visible placeholder when omitted. */
  methodology?: string;
  /** Per-field "tracked since" copy for the `ChartInfo` popup. Falls back
   * to a visible placeholder when omitted. */
  trackingSpan?: TrackingSpan;
  formatValue: (value: number) => string;
  valueLabel: string;
  /** Extra controls rendered before the range picker. The caller owns
   * their state and reshapes `data` accordingly. */
  extraFilters?: React.ReactNode;
  ariaLabel: string;
}) {
  const [range, setRange] = useState<[Date, Date] | null>(null);

  const domain = useMemo<[Date, Date] | null>(() => {
    if (data.length === 0) return null;
    return [parseDate(data[0].date), parseDate(data[data.length - 1].date)];
  }, [data]);

  const points = useMemo<InteractiveCalendarPoint[]>(() => {
    const [from, to] = range ?? [];
    const scoped =
      from && to
        ? data.filter((d) => {
            const date = parseDate(d.date);
            return date >= from && date <= to;
          })
        : data;
    return scoped.map((d) => ({ date: d.date, value: d.value, categories: d.categories }));
  }, [data, range]);

  return (
    <ChartPage
      title={title}
      description={description}
      info={{ interactionGuide: CALENDAR_INTERACTION_GUIDE, methodology, trackingSpan }}
      filters={
        domain ? (
          <>
            {extraFilters}
            <TimeRangePicker domain={domain} value={range} onChange={setRange} />
          </>
        ) : null
      }
    >
      <ChartCard empty={points.length === 0}>
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
      </ChartCard>
    </ChartPage>
  );
}
