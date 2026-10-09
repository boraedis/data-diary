"use client";

import { useMemo, useState } from "react";
import type * as d3 from "d3";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine } from "@/components/charts/interactive/interactive-line";
import { RelativeRangePicker } from "@/components/charts/interactive/relative-range-picker";
import { parseDate, todayDateString } from "@/lib/date";
import { formatDuration } from "@/lib/viz/format";
import type { DateFormatPreset } from "@/lib/viz/format";
import {
  buildPrevalenceSeries,
  prevalenceBucket,
  type PrevalenceEntry,
  type PrevalenceMeasure,
  type PrevalenceWindow,
} from "@/lib/viz/prevalence";

// The small "how often does this show up" line on every manage detail page
// that has a mentions/sessions list (#590). Deliberately barebones — no
// legend, zoom, or point labels — so the page stays about the item and its
// mentions; the hover crosshair InteractiveLine always has is the only
// interaction. The standard chart height class is kept rather than a
// smaller one, so it reads as the same kind of chart as everywhere else.
//
// Fed straight from whatever the page's usage list already holds (see
// src/lib/viz/prevalence.ts for why that's re-bucketed here, not in SQL).

const HEIGHT_CLASS = "h-[min(62vh,640px)] min-h-[320px]";

// Tooltip title per bucket: a month bucket sits on the 1st (a weekday there
// is meaningless), a week bucket on its Monday.
const DATE_FORMAT: Record<ReturnType<typeof prevalenceBucket>, DateFormatPreset> = {
  day: "weekdayYear",
  week: "dayYear",
  month: "monthNameYear",
  quarter: "monthNameYear",
  year: "monthNameYear",
};

const BUCKET_NOUN: Record<ReturnType<typeof prevalenceBucket>, string> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
};

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
    // Whole days only: a short window's small counts would otherwise get
    // "0.5 days" ticks.
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
  title = "Over time",
}: {
  /** Every appearance of the item, any order, duplicates fine — "days"
   * counts distinct dates; "minutes" sums `durationMinutes`. Pass the
   * page's own usage array (it's a memo dependency). */
  entries: readonly PrevalenceEntry[];
  measure?: PrevalenceMeasure;
  /** Names the item in the chart's accessible label. */
  itemLabel: string;
  title?: string;
}) {
  const [range, setRange] = useState<PrevalenceWindow>("all");
  const bucket = prevalenceBucket(range);
  const formats = FORMATS[measure];

  // "Today" is the viewer's local date (src/lib/date.ts). The server's
  // render may disagree near midnight, but nothing it computes here reaches
  // the HTML: ResponsiveChart draws only once it has measured, on the client.
  const series = useMemo(
    () => [
      {
        id: "prevalence",
        label: formats.label,
        // A week or month of days is a handful of 0s and 1s, which the
        // primitive's smoothed curve draws as soft humps; the dots show
        // each day is its own reading. Longer windows are dense enough
        // that the line alone reads right.
        markers: bucket === "day",
        points: buildPrevalenceSeries(entries, range, measure, todayDateString()).map((p) => ({
          x: parseDate(p.start),
          y: formats.y(p.value),
        })),
      },
    ],
    [entries, range, measure, formats, bucket]
  );

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {entries.length > 0 ? <RelativeRangePicker value={range} onChange={setRange} /> : null}
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet, so there&apos;s nothing to chart.</p>
        ) : (
          <ResponsiveChart className={HEIGHT_CLASS}>
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
                dateFormat={DATE_FORMAT[bucket]}
                valueFormat={formats.value}
                yTickFormat={formats.tick}
                ariaLabel={`${itemLabel}: ${formats.aria} per ${BUCKET_NOUN[bucket]}`}
              />
            )}
          </ResponsiveChart>
        )}
      </CardContent>
    </Card>
  );
}
