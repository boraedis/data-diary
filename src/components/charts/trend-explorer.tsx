"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import type { ReferenceLine } from "@/components/charts/interactive/reference-lines";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import {
  cycleOccurrenceKey,
  cycleReferenceDate,
  foldByCycle,
  formatCyclePosition,
  groupByPeriod,
  poolCircularWindow,
  type Cycle,
  type Period,
} from "@/lib/viz/bin";
import { parseDate, toDateString } from "@/lib/date";
import { LINE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import type { TrackingSpan } from "@/lib/viz/tracking-span";

/** "timeline" is the ordinary calendar view; the rest fold every year (or
 * week) onto one axis — see `src/lib/viz/bin.ts`'s cyclical-folding section
 * (#451). A separate picker from `PeriodPicker` rather than extra buttons on
 * it, because a fold isn't a coarser or finer bucket of the same timeline:
 * it replaces the time axis, so the period buttons are hidden while one is
 * on. The range picker stays — it chooses which years get folded. */
type View = "timeline" | Cycle;

const VIEW_OPTIONS: GroupByOption<View>[] = [
  { id: "timeline", label: "Timeline" },
  { id: "weekday", label: "Weekday" },
  { id: "monthOfYear", label: "Month" },
  { id: "dayOfYear", label: "Day of year" },
];

/** ±7 days, so each day-of-year point pools a fortnight of every year logged
 * — wide enough that a handful of years reads as a curve rather than 366
 * jittering single-day means, narrow enough to keep a seasonal turn (the
 * weeks around a holiday) visible. See `poolCircularWindow`. */
const DAY_OF_YEAR_RADIUS = 7;

/** Below this plot width the month-based folds label every third month
 * (Jan/Apr/Jul/Oct) instead of all twelve, which would overlap. */
const NARROW_WIDTH = 480;

function referenceDates(cycle: Cycle, positions: number[]): Date[] {
  return positions.map((p) => parseDate(cycleReferenceDate(cycle, p)));
}

/** Axis ticks and tooltip titles for a fold — `InteractiveLine`'s `xLabels`.
 * Built per (cycle, narrow) pair and memoized by the caller, since the
 * object is a `useD3` dependency. Day of year ticks at each month's 1st and
 * names only the month there; its tooltip gives the full "March 14". */
function foldLabels(cycle: Cycle, narrow: boolean) {
  const months = Array.from({ length: 12 }, (_, m) => m).filter((m) => !narrow || m % 3 === 0);
  // Day of year's month-1st reference dates are the month fold's own.
  const tickValues =
    cycle === "weekday" ? referenceDates(cycle, [0, 1, 2, 3, 4, 5, 6]) : referenceDates("monthOfYear", months);
  return {
    tick: (date: Date) =>
      formatCyclePosition(cycle === "dayOfYear" ? "monthOfYear" : cycle, toDateString(date), true),
    // Day of year's point is a pooled window, not the one day, so its
    // heading says so.
    title: (date: Date) =>
      formatCyclePosition(cycle, toDateString(date)) + (cycle === "dayOfYear" ? ` ±${DAY_OF_YEAR_RADIUS} days` : ""),
    tickValues,
  };
}

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
  band,
  valueFormat,
  tooltipLabel,
  extraSeries,
  extraFilters,
  backHref,
  backLabel,
  initialHiddenIds,
  referenceLines,
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
  /** Whether lines get their ±1 std-dev band. Defaults to on for a mean
   * and off for a sum (see the comment in `computePoints`). Pass `false`
   * for a mean whose spread says nothing the mean doesn't already — a
   * percentage of yes/no days, where the spread is fixed by the percentage
   * itself (Subs Trend's "% of days"). */
  band?: boolean;
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
  /** Series ids the legend opens with toggled off — passed straight
   * through to `InteractiveLine`. For a chart with more lines than read
   * well at once (the nine subs, #120); the reader toggles the rest in. */
  initialHiddenIds?: readonly string[];
  /** Horizontal target lines, passed straight through to `InteractiveLine`
   * — Work Trend's and Sleep Trend's 8h lines (#444). In the same units
   * `getValue` returns. Pass a stable (module-level or memoized) array. */
  referenceLines?: readonly ReferenceLine[];
  ariaLabel: string;
}) {
  const showBand = aggregate === "mean" && band !== false;
  const [period, setPeriod] = useState<Period>("month");
  const [view, setView] = useState<View>("timeline");
  const [range, setRange] = useState<[Date, Date] | null>(null);
  const cycle = view === "timeline" ? null : view;

  const domain = useMemo<[Date, Date] | null>(() => {
    if (data.length === 0) return null;
    return [parseDate(data[0].date), parseDate(data[data.length - 1].date)];
  }, [data]);

  // Timeline periods and fold positions both reduce to "a start date and
  // its rows" here — all the point math below needs from either.
  const buckets = useMemo<{ start: string; items: T[] }[]>(() => {
    const [from, to] = range ?? [];
    const scoped =
      from && to
        ? data.filter((item) => {
            const date = parseDate(item.date);
            return date >= from && date <= to;
          })
        : data;
    if (cycle === null) return groupByPeriod(scoped, period, (item) => item.date);
    const folded = foldByCycle(scoped, cycle, (item) => item.date);
    return cycle === "dayOfYear" ? poolCircularWindow(folded, cycle, DAY_OF_YEAR_RADIUS) : folded;
  }, [data, period, cycle, range]);

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
      // A folded sum averages each occurrence's total (a typical January's
      // hours, not every January's added together — see
      // `cycleOccurrenceKey`), so its values are those totals; a folded or
      // unfolded mean pools the days themselves.
      const values =
        cycle !== null && aggregate === "sum"
          ? Array.from(
              d3.rollup(
                included,
                (group) => group.reduce((sum, item) => sum + (valueOf(item) as number), 0),
                (item) => cycleOccurrenceKey(cycle, item.date),
              ).values(),
            )
          : included.map((item) => valueOf(item) as number);
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
        y: aggregate === "sum" && cycle === null ? total : mean,
        ...(aggregate === "mean" ? { bandLow: mean - stdDev, bandHigh: mean + stdDev } : {}),
      });
      itemsByPoint.push(included);
    }
    return { points, itemsByPoint };
  };

  // getValue/extraSeries are usually inline arrows, so depending on their
  // identity would rebuild every render. What actually changes which values
  // a line reads is *which* line it is, so each series' id + label stand in
  // for its closure — a caller that swaps a series' meaning changes one of
  // them (Happiness Trend's work-day split renames the primary line from
  // "happiness" to "workday"; Sleep Trend's naps measure relabels "Sleep"
  // to "Sleep + Naps"), and that's what triggers the recompute. Keying on
  // `buckets`/`aggregate` alone (as before) left the primary line showing
  // the previous mode's values under the new mode's name.
  const primaryKey = `${seriesId}:${label}`;
  const extraSeriesKey = (extraSeries ?? []).map((s) => `${s.id}:${s.label}`).join("|");

  const primary = useMemo(
    () => computePoints(getValue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, aggregate, cycle, primaryKey],
  );
  const points = primary.points;

  const extraComputed = useMemo(
    () => (extraSeries ?? []).map((s) => computePoints(s.getValue)),
    // See `extraSeriesKey` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, aggregate, cycle, extraSeriesKey],
  );

  // With more than one line, every tooltip row needs its line's name: the
  // default "N days" caption alone would leave the swatch colour as the
  // only thing saying which row is which. A lone line's name is already
  // the chart's title, so it keeps the bare caption.
  const multiSeries = (extraSeries?.length ?? 0) > 0;
  const rowLabel = (seriesLabel: string, items: T[]) => {
    const caption = tooltipLabel ? tooltipLabel(items) : `${items.length} day${items.length === 1 ? "" : "s"}`;
    return multiSeries ? `${seriesLabel} · ${caption}` : caption;
  };

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

  // Both widths up front, so the render prop below only picks one — it
  // can't call hooks itself, and a fresh object per render would rebuild
  // the SVG on every render (`xLabels` is a `useD3` dependency).
  const xLabels = useMemo(
    () => (cycle === null ? null : { wide: foldLabels(cycle, false), narrow: foldLabels(cycle, true) }),
    [cycle],
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
            <GroupByPicker label="View" value={view} onChange={setView} options={VIEW_OPTIONS} />
            {cycle === null ? <PeriodPicker value={period} onChange={setPeriod} /> : null}
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
                  band: showBand,
                  markers: (_point, i) => radiusScale(primary.itemsByPoint[i]?.length ?? 0),
                  tooltipLabel: (_point, i) => rowLabel(label, primary.itemsByPoint[i] ?? []),
                },
                ...(extraSeries ?? []).map((s, si) => ({
                  id: s.id,
                  label: s.label,
                  color: s.color,
                  points: extraComputed[si]?.points ?? [],
                  band: showBand,
                  markers: (_point: InteractiveLinePoint, pointIndex: number) =>
                    radiusScale(extraComputed[si]?.itemsByPoint[pointIndex]?.length ?? 0),
                  tooltipLabel: (_point: InteractiveLinePoint, pointIndex: number) =>
                    rowLabel(s.label, extraComputed[si]?.itemsByPoint[pointIndex] ?? []),
                })),
              ]}
              width={width}
              height={height}
              valueFormat={valueFormat}
              dateFormat="monthYear"
              xLabels={xLabels ? (width < NARROW_WIDTH ? xLabels.narrow : xLabels.wide) : undefined}
              initialHiddenIds={initialHiddenIds}
              referenceLines={referenceLines}
              ariaLabel={ariaLabel}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
