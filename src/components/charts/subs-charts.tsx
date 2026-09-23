"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { CalendarExplorer, type CalendarDay } from "@/components/charts/calendar-explorer";
import { DailyExplorer, type DailyExplorerSeries } from "@/components/charts/daily-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { Legend } from "@/components/charts/interactive/legend";
import { SUB_NAMES } from "@/lib/days";
import type { ProfileRegionGroups, SubsDay } from "@/lib/charts";
import { DEFAULT_HIDDEN_SUBS, SUB_COLORS } from "@/lib/viz/subs";
import { SUBS_METHODOLOGY } from "@/lib/viz/methodology";
import { SUBS_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// The three subs charts (#120). Legacy drew these as a 3×3 grid of axis-less
// sparklines, one per sub, which is what let it get away with nine colours
// from `schemeTableau10`: no two ever shared a plot. Putting all nine back
// on shared axes brings the >5-series problem back, and it's answered here
// in two parts rather than by letting slots 6-9 fold into grey:
//
// - Every sub keeps its own named colour (`SUB_COLORS`, chosen by the user
//   for what each sub is), the same on all three charts.
// - The line charts open on the three subs with real signal (A, W, Ni) and
//   leave the other six toggled off in the legend, rather than drawing six
//   lines lying flat along zero. Anyone who wants one clicks it on.
//
// See coffee-charts.tsx for why this thin client layer exists at all: the
// shared explorers take formatter functions, which a server-component page
// can't pass across the boundary.

const formatScore = (value: number) => value.toFixed(1);

// Age/Occupation/Residence/Relationship, opt-in — the same region picker
// the other daily charts have (see distance-charts.tsx), starting at none.
type RegionType = "none" | "age" | "occupation" | "residence" | "relationship";

const REGION_TYPE_OPTIONS: GroupByOption<RegionType>[] = [
  { id: "none", label: "None" },
  { id: "age", label: "Age" },
  { id: "occupation", label: "Occupation" },
  { id: "residence", label: "Residence" },
  { id: "relationship", label: "Relationship" },
];

/**
 * Every logged day's score for each sub, zoomable, with a rolling average.
 *
 * A day where a sub was left blank is left off that sub's line rather than
 * plotted as 0 — see `SubsDay`. In practice every sub has been filled in
 * on every logged day since tracking began, so this rarely shows.
 */
export function SubsDailyChart({ data, regionGroups }: { data: SubsDay[]; regionGroups?: ProfileRegionGroups }) {
  const [regionType, setRegionType] = useState<RegionType>("none");
  const regions = useMemo(
    () => (regionType === "none" ? [] : (regionGroups?.[regionType] ?? [])),
    [regionType, regionGroups],
  );

  // Memoized: DailyExplorer rebuilds its scroller series whenever this
  // array's identity changes.
  const series = useMemo<DailyExplorerSeries[]>(
    () =>
      SUB_NAMES.map((name, i) => ({
        id: name,
        label: name,
        color: SUB_COLORS[name],
        data: data
          .filter((day) => day.values[i] !== null)
          .map((day) => ({ date: day.date, value: day.values[i] as number })),
      })),
    [data],
  );

  return (
    <DailyExplorer
      series={series}
      title="Daily Subs"
      description="A day-by-day look at each sub's 0–10 score. Opens on A, W and Ni; click a sub in the legend to add or hide it."
      methodology={SUBS_METHODOLOGY}
      trackingSpan={SUBS_TRACKING_SPAN}
      valueFormat={formatScore}
      regions={regions}
      initialHiddenIds={DEFAULT_HIDDEN_SUBS}
      extraFilters={
        regionGroups ? (
          <GroupByPicker value={regionType} onChange={setRegionType} options={REGION_TYPE_OPTIONS} label="Regions" />
        ) : null
      }
      ariaLabel="Daily sub scores, one line per sub; use the legend to show or hide each. Scroll or pinch to zoom, drag to pan, hover a day for its exact scores."
    />
  );
}

/**
 * What each period's point means:
 *
 * - `average` — legacy's own measure: the mean 0–10 score over the
 *   period's logged days. Zeros count; a day without the sub pulls the
 *   average down, which is the point ("how much, day to day").
 * - `share` — the percentage of logged days the sub was above zero. It
 *   separates *how often* from *how much*, which the average blends
 *   together: a few heavy days and many light ones can average out the same.
 */
type SubsMeasure = "average" | "share";

const MEASURE_OPTIONS: GroupByOption<SubsMeasure>[] = [
  { id: "average", label: "Average score" },
  { id: "share", label: "% of days" },
];

const formatShare = (value: number) => `${Math.round(value)}%`;

/**
 * Each sub's trend, bucketed by period.
 *
 * The measure is applied by rewriting the rows before they reach
 * `TrendExplorer` (each score becomes 100 or 0 for "% of days", whose mean
 * is then the percentage), rather than by swapping `getValue`s. That keeps
 * the explorer's own bucketing untouched: new rows are new data, and every
 * line recomputes from them.
 *
 * The ±1 std-dev band only appears with a single line on screen (an
 * `InteractiveLine` rule), and not at all for "% of days": the spread of a
 * set of yes/no days is fixed by the percentage itself, so a band there
 * would restate the line rather than add anything.
 */
export function SubsTrendChart({ data }: { data: SubsDay[] }) {
  const [measure, setMeasure] = useState<SubsMeasure>("average");

  const rows = useMemo<SubsDay[]>(
    () =>
      measure === "average"
        ? data
        : data.map((day) => ({
            date: day.date,
            values: day.values.map((value) => (value === null ? null : value > 0 ? 100 : 0)),
          })),
    [data, measure],
  );

  const valueAt = (i: number) => (day: SubsDay) => day.values[i] ?? undefined;
  const [first, ...rest] = SUB_NAMES;

  return (
    <TrendExplorer
      data={rows}
      title="Subs Trend"
      description={
        measure === "average"
          ? "Each sub's average daily score (0–10), by period. Opens on A, W and Ni; click a sub in the legend to add or hide it."
          : "The share of days each sub was above zero, by period. Opens on A, W and Ni; click a sub in the legend to add or hide it."
      }
      methodology={SUBS_METHODOLOGY}
      trackingSpan={SUBS_TRACKING_SPAN}
      seriesId={first}
      label={first}
      color={SUB_COLORS[first]}
      getValue={valueAt(0)}
      extraSeries={rest.map((name, i) => ({
        id: name,
        label: name,
        color: SUB_COLORS[name],
        getValue: valueAt(i + 1),
      }))}
      aggregate="mean"
      band={measure === "average"}
      valueFormat={measure === "average" ? formatScore : formatShare}
      initialHiddenIds={DEFAULT_HIDDEN_SUBS}
      extraFilters={<GroupByPicker value={measure} onChange={setMeasure} options={MEASURE_OPTIONS} label="Measure" />}
      ariaLabel={
        measure === "average"
          ? "Average daily score per sub over time, one line per sub. Use the legend to show or hide each; hover a point for its value."
          : "Percentage of days each sub was above zero over time, one line per sub. Use the legend to show or hide each; hover a point for its value."
      }
    />
  );
}

/** Fill for a logged day where every sub was 0 — a quiet neutral one step
 * up from the card, so "logged, nothing" still reads as a real cell and
 * stays distinct from a day that wasn't logged at all (no cell). */
const NO_SUBS_COLOR = "#3a302a";

// The calendar's key: every sub's swatch, plus the all-zero fill. Static,
// not click-to-toggle — every sub always feeds the mix here.
const CALENDAR_KEY = [
  ...SUB_NAMES.map((name) => ({ label: name, color: SUB_COLORS[name] })),
  { label: "None", color: NO_SUBS_COLOR },
];

/**
 * One cell per day, coloured by the mix of subs that day — the People
 * Calendar's tag-mix idea applied to subs. Net new: legacy never had a
 * subs calendar.
 *
 * - **Hue** is the Lab blend of every sub above zero that day, each
 *   weighted by its score, so a heavy A day with a little W reads as mostly
 *   gold. All nine always feed it; there's no picker.
 * - **Strength** is the day's total across all nine subs. A day with
 *   several subs reads heavier than a day with one, as it should. Full
 *   strength is reached at the 90th-percentile day (see `intensityCap`).
 * - A logged day with everything at 0 gets a flat neutral (`NO_SUBS_COLOR`).
 *
 * The sequential interpolator passed below is constant on purpose. In blend
 * mode `InteractiveCalendar` only ever samples its ramp at the low end — as
 * the fill for days with no categories, and as the starting point each
 * blend is faded in from — so a constant neutral there is what keeps the
 * default terracotta ramp from tinting every sub's colour.
 */
export function SubsCalendarChart({ data }: { data: SubsDay[] }) {
  const points = useMemo<CalendarDay[]>(
    () =>
      data.map((day) => {
        let total = 0;
        const categories: NonNullable<CalendarDay["categories"]> = [];
        day.values.forEach((value, i) => {
          if (value === null || value <= 0) return;
          const name = SUB_NAMES[i];
          total += value;
          categories.push({ label: name, color: SUB_COLORS[name], weight: value, value: String(value) });
        });
        return { date: day.date, value: total, categories };
      }),
    [data],
  );

  // Full colour from the 90th-percentile total up, rather than only at the
  // single heaviest day: the history's max is about six times its median,
  // so scaling to the max left an ordinary day barely tinted. Taken over
  // days with any sub at all, so a long run of all-zero days can't drag
  // the cap down.
  const intensityCap = useMemo(
    () => d3.quantile(points.filter((p) => p.value > 0), 0.9, (p) => p.value),
    [points],
  );

  return (
    <CalendarExplorer
      data={points}
      title="Subs Calendar"
      description="Each day coloured by its mix of subs, weighted by score; stronger colour means a higher combined score. Hover a day for the breakdown."
      methodology={SUBS_METHODOLOGY}
      trackingSpan={SUBS_TRACKING_SPAN}
      formatValue={(n) => String(n)}
      valueLabel="Combined score"
      colorInterpolator={() => NO_SUBS_COLOR}
      legend={<Legend series={CALENDAR_KEY} className="mb-3" />}
      blendIntensityCap={intensityCap}
      ariaLabel="Calendar of daily subs, each day coloured by the mix of subs logged that day and shaded by their combined score."
    />
  );
}
