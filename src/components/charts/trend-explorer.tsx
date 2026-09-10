"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { parseDate } from "@/lib/date";
import { LINE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

/**
 * Legacy's "averager" shape with real controls: a value per period, over a
 * selectable date range, at a selectable bucket size.
 *
 * The bucketing happens here rather than in SQL precisely so the period
 * picker can exist — that's the split `src/lib/viz/bin.ts` describes, where
 * re-bucketing an already-fetched series is the helper's whole purpose. The
 * fetchers behind this all return daily values.
 *
 * Owns the page shell rather than being dropped into one, following
 * `WeightScrollerChart`: the filters row and the chart share state, and
 * `ChartPage` renders them into separate slots, so a common ancestor has to
 * hold it. That ancestor can't be the page itself, since pages are server
 * components and formatter props can't cross that boundary.
 */
export function TrendExplorer<T extends { date: string }>({
  data,
  title,
  description,
  methodology,
  seriesId,
  label,
  color,
  getValue,
  aggregate,
  valueFormat,
  tooltipLabel,
  extraFilters,
  ariaLabel,
}: {
  data: T[];
  title: string;
  description: string;
  /** Per-chart methodology copy for the `ChartInfo` popup — see #316.
   * Falls back to a visible placeholder when omitted. */
  methodology?: string;
  seriesId: string;
  label: string;
  color: string;
  getValue: (item: T) => number;
  /** `mean` for a rate ("cups per day"), `sum` for a volume ("hours
   * trained"). The distinction changes what an empty bucket means, so it's
   * required rather than defaulted. */
  aggregate: "mean" | "sum";
  valueFormat: (value: number) => string;
  /** Secondary tooltip line for a bucket, given the rows behind it. */
  tooltipLabel?: (items: T[]) => string;
  /** Extra controls for the filters row, rendered before the period and
   * range pickers. The caller owns their state and pre-filters `data`
   * accordingly — this component only lays them out, so a chart can add a
   * dimension without this one growing a mode for it. */
  extraFilters?: React.ReactNode;
  ariaLabel: string;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<[Date, Date] | null>(null);

  const domain = useMemo<[Date, Date] | null>(() => {
    if (data.length === 0) return null;
    return [parseDate(data[0].date), parseDate(data[data.length - 1].date)];
  }, [data]);

  const buckets = useMemo(() => {
    const [from, to] = range ?? [];
    const scoped =
      from && to
        ? data.filter((item) => {
            const date = parseDate(item.date);
            return date >= from && date <= to;
          })
        : data;
    return groupByPeriod(scoped, period, (item) => item.date);
  }, [data, period, range]);

  const points = useMemo<InteractiveLinePoint[]>(
    () =>
      buckets.map(({ start, items }) => {
        const values = items.map(getValue);
        const total = values.reduce((sum, v) => sum + v, 0);
        return {
          x: parseDate(start),
          y: aggregate === "sum" ? total : total / values.length,
          // A range band only means something for a mean — for a sum it
          // would be the spread of the parts, which says nothing about the
          // total the line is drawing.
          ...(aggregate === "mean"
            ? { bandLow: Math.min(...values), bandHigh: Math.max(...values) }
            : {}),
        };
      }),
    // getValue is stable per call site in practice; including it would
    // rebuild on every render for callers passing an inline arrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, aggregate],
  );

  // Marker radius by sample size — a bucket built from 30 days reads as
  // more confident than one built from 2.
  const radiusScale = useMemo(
    () =>
      d3
        .scaleSqrt()
        .domain([0, d3.max(buckets, (b) => b.items.length) ?? 1])
        .range([1.5, 5]),
    [buckets],
  );

  return (
    <ChartPage
      title={title}
      description={description}
      info={{ interactionGuide: LINE_INTERACTION_GUIDE, methodology }}
      filters={
        domain ? (
          <>
            {extraFilters}
            <PeriodPicker value={period} onChange={setPeriod} />
            <TimeRangePicker domain={domain} value={range} onChange={setRange} />
          </>
        ) : null
      }
    >
      <ChartCard empty={points.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveLine
              series={[
                {
                  id: seriesId,
                  label,
                  color,
                  points,
                  band: aggregate === "mean",
                  markers: (_point, i) => radiusScale(buckets[i]?.items.length ?? 0),
                  tooltipLabel: (_point, i) => {
                    const items = buckets[i]?.items ?? [];
                    if (tooltipLabel) return tooltipLabel(items as T[]);
                    return `${items.length} day${items.length === 1 ? "" : "s"}`;
                  },
                },
              ]}
              width={width}
              height={height}
              valueFormat={valueFormat}
              dateFormat="monthYear"
              ariaLabel={ariaLabel}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
