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
import type { TrackingSpan } from "@/lib/viz/tracking-span";

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
  trackingSpan,
  seriesId,
  label,
  color,
  getValue,
  aggregate,
  valueFormat,
  tooltipLabel,
  extraSeries,
  extraFilters,
  backHref,
  backLabel,
  ariaLabel,
}: {
  data: T[];
  title: string;
  description: string;
  /** Per-chart methodology copy for the `ChartInfo` popup — see #316.
   * Falls back to a visible placeholder when omitted. */
  methodology?: string;
  /** Per-field "tracked since" copy for the `ChartInfo` popup. Falls back
   * to a visible placeholder when omitted. */
  trackingSpan?: TrackingSpan;
  seriesId: string;
  label: string;
  color: string;
  /** Return `undefined` to exclude an item from *this series'* bucket
   * math entirely — not counted toward its mean/sum, not diluting its
   * std-dev band — rather than, say, mapping it to 0. This is what makes
   * a same-buckets split series possible (a "work days" line whose
   * `getValue` returns `undefined` for every non-work day): each series
   * can effectively pre-filter its own share of a bucket's rows while
   * still sharing the one bucketing pass with every other series on the
   * chart. A bucket where every item is excluded produces no point at all
   * for that series (a real gap — e.g. a week with zero work days on the
   * "work days" line — not a 0 or a NaN). */
  getValue: (item: T) => number | undefined;
  /** `mean` for a rate ("cups per day"), `sum` for a volume ("hours
   * trained"). The distinction changes what an empty bucket means, so it's
   * required rather than defaulted. Shared by every series on this chart —
   * `extraSeries` below is for a second *related* value on the same
   * footing (sleep vs. sleep+naps), not an independently-aggregated one. */
  aggregate: "mean" | "sum";
  valueFormat: (value: number) => string;
  /** Secondary tooltip line for a bucket, given the rows *this series*
   * actually included (after its own `getValue` filtering, if any) — not
   * necessarily every row in the bucket. */
  tooltipLabel?: (items: T[]) => string;
  /** Additional line(s) sharing this chart's own buckets, aggregate, and
   * tooltip — e.g. "sleep" and "sleep+naps" plotted together so both are
   * visible at once instead of only ever one or the other, or a boolean
   * split (a "work days" line and an "other days" line, each excluding
   * the other's rows via `getValue`). Each gets its own `getValue`/band
   * computed from the exact same buckets as the primary series, not a
   * second independent dataset. */
  extraSeries?: { id: string; label: string; color: string; getValue: (item: T) => number | undefined }[];
  /** Extra controls for the filters row, rendered before the period and
   * range pickers. The caller owns their state and pre-filters `data`
   * accordingly — this component only lays them out, so a chart can add a
   * dimension without this one growing a mode for it. */
  extraFilters?: React.ReactNode;
  /** Passed straight through to the internal `ChartPage` — see its own
   * defaults ("/charts"/"Charts"). Only needed by a chart whose public and
   * private pages both render this same component (the public page passes
   * "/public-charts"/"Charts"), same pattern `SleepCalendarChart` uses. */
  backHref?: string;
  backLabel?: string;
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

  // Shared by the primary series and every `extraSeries` entry — they all
  // bucket the exact same rows, just summarized by different `getValue`s,
  // so the bucketing/std-dev math only needs writing once. Returns
  // `itemsByPoint` alongside `points`, in step with each other (both
  // filtered to buckets where this series actually has at least one
  // included item), rather than a plain `InteractiveLinePoint[]` callers
  // could index into `buckets` by position — a series that excludes some
  // rows (`getValue` returning `undefined` for them) can end up with
  // *fewer* points than there are buckets, so "point i" and "bucket i" are
  // no longer the same bucket once any series does that.
  const computePoints = (
    valueOf: (item: T) => number | undefined,
  ): { points: InteractiveLinePoint[]; itemsByPoint: T[][] } => {
    const points: InteractiveLinePoint[] = [];
    const itemsByPoint: T[][] = [];
    for (const { start, items } of buckets) {
      const included = items.filter((item) => valueOf(item) !== undefined);
      if (included.length === 0) continue;
      const values = included.map((item) => valueOf(item) as number);
      const total = values.reduce((sum, v) => sum + v, 0);
      const mean = total / values.length;
      // A spread band only means something for a mean — for a sum it
      // would be the spread of the parts, which says nothing about the
      // total the line is drawing.
      //
      // ±1 standard deviation rather than min/max: min/max widens with
      // sample size alone (a 30-day bucket's extremes are almost always
      // further apart than a 2-day bucket's, regardless of how
      // consistent the underlying days actually were), so it reads as
      // "how many days fed this point" more than "how variable were
      // they." Std dev is the sample's own spread and doesn't have that
      // bias. A single-item bucket has zero variance by construction —
      // that's a real, honest band (one data point, no spread to show),
      // not a bug.
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);
      points.push({
        x: parseDate(start),
        y: aggregate === "sum" ? total : mean,
        ...(aggregate === "mean" ? { bandLow: mean - stdDev, bandHigh: mean + stdDev } : {}),
      });
      itemsByPoint.push(included);
    }
    return { points, itemsByPoint };
  };

  const primary = useMemo(
    () => computePoints(getValue),
    // getValue is stable per call site in practice; including it would
    // rebuild on every render for callers passing an inline arrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, aggregate],
  );
  const points = primary.points;

  const extraComputed = useMemo(
    () => (extraSeries ?? []).map((s) => computePoints(s.getValue)),
    // extraSeries entries' getValues are stable per call site, same as
    // getValue above; extraSeries.length is the real dependency (whether
    // the set of lines itself changed), not the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, aggregate, extraSeries?.length],
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
      info={{ interactionGuide: LINE_INTERACTION_GUIDE, methodology, trackingSpan }}
      backHref={backHref}
      backLabel={backLabel}
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
                  markers: (_point, i) => radiusScale(primary.itemsByPoint[i]?.length ?? 0),
                  tooltipLabel: (_point, i) => {
                    const items = primary.itemsByPoint[i] ?? [];
                    if (tooltipLabel) return tooltipLabel(items);
                    return `${items.length} day${items.length === 1 ? "" : "s"}`;
                  },
                },
                ...(extraSeries ?? []).map((s, si) => ({
                  id: s.id,
                  label: s.label,
                  color: s.color,
                  points: extraComputed[si]?.points ?? [],
                  band: aggregate === "mean",
                  markers: (_point: InteractiveLinePoint, pointIndex: number) =>
                    radiusScale(extraComputed[si]?.itemsByPoint[pointIndex]?.length ?? 0),
                  tooltipLabel: (_point: InteractiveLinePoint, pointIndex: number) => {
                    const items = extraComputed[si]?.itemsByPoint[pointIndex] ?? [];
                    if (tooltipLabel) return tooltipLabel(items);
                    return `${items.length} day${items.length === 1 ? "" : "s"}`;
                  },
                })),
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
