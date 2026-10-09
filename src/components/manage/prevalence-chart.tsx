"use client";

import { useMemo, useState } from "react";
import type * as d3 from "d3";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine } from "@/components/charts/interactive/interactive-line";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { parseDate, todayDateString } from "@/lib/date";
import { formatDuration } from "@/lib/viz/format";
import {
  buildPrevalenceSeries,
  type PrevalenceEntry,
  type PrevalenceMeasure,
  type PrevalencePeriod,
} from "@/lib/viz/prevalence";

// The small "how often does this show up" line on every manage detail page
// that has a mentions/sessions list (#590): days (or play time) per year,
// month or week across the item's whole history. Deliberately barebones —
// no legend, zoom, or point labels — so the page stays about the item and
// its mentions; the hover crosshair InteractiveLine always has is the only
// interaction.
//
// A fixed, short height rather than the chart pages' standard
// `h-[min(62vh,640px)]`: at that size it pushed the mentions list below the
// fold, and the list is what these pages are for (owner feedback on #624).
//
// Fed straight from whatever the page's usage list already holds (see
// src/lib/viz/prevalence.ts for why that's re-bucketed here, not in SQL).

const HEIGHT = 220;

const PERIODS: PrevalencePeriod[] = ["year", "month", "week"];

const yearOf = (d: Date) => String(d.getFullYear());

// Module-level so they're stable: InteractiveLine's useD3 rebuilds the
// whole <svg> whenever one of these changes identity.
const FORMATS: Record<
  PrevalenceMeasure,
  {
    /** Bucket value → plotted y. Minutes go up as hours so d3's "nice"
     * ticks land on 1h/2h/5h rather than 100-minute steps (1h 40m, 3h 20m). */
    y: (v: number) => number;
    value: (y: number) => string;
    tick: (v: d3.NumberValue) => string;
    label: string;
    aria: string;
  }
> = {
  days: {
    y: (days) => days,
    value: (days) => `${days} ${days === 1 ? "day" : "days"}`,
    // Whole days only: a quiet item's small weekly counts would otherwise
    // get "0.5 days" ticks.
    tick: (v) => (Number.isInteger(Number(v)) ? String(v) : ""),
    label: "Days",
    aria: "days logged",
  },
  minutes: {
    y: (minutes) => minutes / 60,
    value: (hours) => formatDuration(hours),
    tick: (v) => formatDuration(Number(v)),
    label: "Played",
    aria: "time played",
  },
};

export function PrevalenceChart({
  entries,
  measure = "days",
  itemLabel,
  color,
  title = "Over time",
}: {
  /** Every appearance of the item, any order, duplicates fine — "days"
   * counts distinct dates; "minutes" sums `durationMinutes`. Pass the
   * page's own usage array (it's a memo dependency). */
  entries: readonly PrevalenceEntry[];
  measure?: PrevalenceMeasure;
  /** Names the item in the chart's accessible label. */
  itemLabel: string;
  /** The item's own colour where it has one (a person's tag, a place's
   * region/country, a team's), so the line matches how that item is
   * drawn elsewhere. Falls back to the first categorical slot. */
  color?: string | null;
  title?: string;
}) {
  const [period, setPeriod] = useState<PrevalencePeriod>("month");
  const formats = FORMATS[measure];

  // "Today" is the viewer's local date (src/lib/date.ts). The server's
  // render may disagree near midnight, but nothing it computes here reaches
  // the HTML: ResponsiveChart draws only once it has measured, on the client.
  const points = useMemo(
    () => buildPrevalenceSeries(entries, period, measure, todayDateString()),
    [entries, period, measure]
  );
  const series = useMemo(
    () => [
      {
        id: "prevalence",
        label: formats.label,
        color: color ?? undefined,
        // A handful of yearly points read better as dots on a line than
        // as a bare curve; month and week runs are dense enough without.
        markers: period === "year",
        points: points.map((p) => ({ x: parseDate(p.start), y: formats.y(p.value) })),
      },
    ],
    [points, period, formats, color]
  );
  // Year buckets sit on Jan 1, so the default "January 2024"-style title
  // would misread; name just the year, with one tick per point so d3 can't
  // place two ticks inside the same year. Memoized: it's a useD3 dependency.
  const yearLabels = useMemo(
    () => (period === "year" ? { tick: yearOf, title: yearOf, tickValues: series[0].points.map((p) => p.x) } : undefined),
    [period, series]
  );

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {points.length > 0 ? (
            <PeriodPicker<PrevalencePeriod> value={period} onChange={setPeriod} periods={PERIODS} label="Per" />
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet, so there&apos;s nothing to chart.</p>
        ) : (
          <ResponsiveChart height={HEIGHT}>
            {({ width, height }) => (
              <InteractiveLine
                series={series}
                width={width}
                height={height}
                zoom="none"
                yMin={0}
                showLegend={false}
                lineLabels={false}
                pointLabels={false}
                dateFormat={period === "month" ? "monthNameYear" : "dayYear"}
                xLabels={yearLabels}
                valueFormat={formats.value}
                yTickFormat={formats.tick}
                ariaLabel={`${itemLabel}: ${formats.aria} per ${period}`}
              />
            )}
          </ResponsiveChart>
        )}
      </CardContent>
    </Card>
  );
}
