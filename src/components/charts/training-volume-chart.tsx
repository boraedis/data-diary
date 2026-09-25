"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveLine,
  type InteractiveLinePoint,
  type InteractiveLineSeries,
} from "@/components/charts/interactive/interactive-line";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { parseDate } from "@/lib/date";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import { EXERCISE_CATEGORY_COLORS, EXERCISE_CATEGORY_LABELS, EXERCISE_CATEGORY_ORDER, type ExerciseWorkoutRow, type TrainingDay } from "@/lib/charts";
import { LINE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { TRAINING_METHODOLOGY } from "@/lib/viz/methodology";
import { TRAINING_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Exercise Trend (#226, reworked #411) — was a thin TrendExplorer wrapper
// plotting the bucket's *summed* training time; rebuilt as its own explorer
// (same shape as ExerciseMixExplorer's own client-side filters/re-bucketing
// pipeline) for three things TrendExplorer's single-series shape can't do:
//
//  1. **Average daily duration, not the bucket's sum.** A 31-day month and
//     a 28-day one trained identically shouldn't draw different heights
//     just because one bucket is longer — the sum answers "how long was
//     this month," the average answers "how much did a typical day in it
//     look like," and the latter is the more honest trend line. The sum
//     still rides in the tooltip (see `laneTooltip` below).
//  2. **A category/exercise breakdown**, each as its own line sharing the
//     std-dev-band-only-when-one-visible + click-to-toggle-legend behavior
//     InteractiveLine now has (#411's other half). "Exercise" caps at the
//     top 10 by volume + "Other" — unlike ExerciseMixExplorer's own
//     "exercise" grouping (a *stacked* area, where every band's own sum has
//     to add up to the whole), a dozen simultaneous lines is genuinely hard
//     to read regardless of whether they stack, so the cap here is a
//     deliberate difference from that chart, not an oversight.
//  3. **A fixed, zero-floored y-axis.** Duration is never negative, so
//     there's no reason the axis's low end should ever wander.
//
// Every lane's value is computed from `getExerciseWorkoutRows` alone (never
// `TrainingDay.minutes` directly), even in "None" mode — the two fetchers
// compute a workout's duration with a slightly different fallback (see
// `TrainingDay`'s own doc comment), and deriving every lane the same way
// guarantees "Total" always equals the sum of any breakdown's own lanes.
// `TrainingDay` still supplies the one thing only it has: the *zero-filled*
// full calendar-day range (including untrained days), which is what makes
// "average daily duration" — dividing by every day in a bucket, not just
// the ones with training in them — correct in the first place.

type GroupBy = "none" | "category" | "exercise";
const OTHER_ID = "__other__";
const TOTAL_ID = "total";

const GROUP_BY_OPTIONS: GroupByOption<GroupBy>[] = [
  { id: "none", label: "None" },
  { id: "category", label: "Category" },
  { id: "exercise", label: "Exercise" },
];

const TOP_EXERCISES = 10;

type Lane = { id: string; label: string; color: string };

/** The fixed set of lanes for the current grouping — like
 * ExerciseMixExplorer's `buildCategories`, computed once from every
 * (already time-range-filtered) row rather than per-bucket, so a lane's
 * presence/color doesn't flicker per period. "Category" is a small fixed
 * set in catalog order; "exercise" is ranked by volume and capped at the
 * top 10 + "Other" — see this file's own header comment for why the cap
 * differs from ExerciseMixExplorer's uncapped stacked version. */
function buildLanes(rows: ExerciseWorkoutRow[], groupBy: GroupBy): Lane[] {
  if (groupBy === "none") {
    return [{ id: TOTAL_ID, label: "Time trained", color: categoricalColor(1) }];
  }
  if (groupBy === "category") {
    return EXERCISE_CATEGORY_ORDER.map((id) => ({
      id,
      label: EXERCISE_CATEGORY_LABELS[id] ?? id,
      color: EXERCISE_CATEGORY_COLORS[id],
    }));
  }
  const totals = new Map<number, { label: string; hours: number }>();
  for (const row of rows) {
    const existing = totals.get(row.exerciseId);
    if (existing) existing.hours += row.hours;
    else totals.set(row.exerciseId, { label: row.exerciseName, hours: row.hours });
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].hours - a[1].hours);
  const top = ranked.slice(0, TOP_EXERCISES);
  const lanes: Lane[] = top.map(([id, v], i) => ({ id: String(id), label: v.label, color: categoricalColor(i) }));
  if (ranked.length > TOP_EXERCISES) {
    lanes.push({ id: OTHER_ID, label: "Other", color: categoricalColor(lanes.length) });
  }
  return lanes;
}

function laneIdFor(row: ExerciseWorkoutRow, groupBy: GroupBy, topExerciseIds: ReadonlySet<number>): string {
  switch (groupBy) {
    case "none":
      return TOTAL_ID;
    case "category":
      return row.category;
    case "exercise":
      return topExerciseIds.has(row.exerciseId) ? String(row.exerciseId) : OTHER_ID;
  }
}

/** Every zero-filled calendar day (from `days`) mapped to its per-lane
 * hours that day, defaulting every lane to 0 — the zero default is what
 * makes an untrained day (or a trained day that just didn't touch a given
 * lane) count as a real 0 in that lane's average/std-dev rather than being
 * silently absent from it. */
function buildDayLaneHours(
  days: TrainingDay[],
  rows: ExerciseWorkoutRow[],
  lanes: Lane[],
  groupBy: GroupBy,
  topExerciseIds: ReadonlySet<number>,
): Map<string, Record<string, number>> {
  const index = new Map<string, Record<string, number>>();
  for (const d of days) {
    const rec: Record<string, number> = {};
    for (const lane of lanes) rec[lane.id] = 0;
    index.set(d.date, rec);
  }
  for (const row of rows) {
    const rec = index.get(row.date);
    if (!rec) continue; // outside the current day range (shouldn't happen — same underlying table)
    const laneId = laneIdFor(row, groupBy, topExerciseIds);
    rec[laneId] = (rec[laneId] ?? 0) + row.hours;
  }
  return index;
}

export function TrainingVolumeChart({ data, rows }: { data: TrainingDay[]; rows: ExerciseWorkoutRow[] }) {
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<[Date, Date] | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const fullDomain = useMemo<[Date, Date] | null>(() => {
    if (data.length === 0) return null;
    return [parseDate(data[0].date), parseDate(data[data.length - 1].date)];
  }, [data]);

  const rangedDays = useMemo(() => {
    if (!range) return data;
    const [from, to] = range;
    return data.filter((d) => {
      const date = parseDate(d.date);
      return date >= from && date <= to;
    });
  }, [data, range]);

  const rangedRows = useMemo(() => {
    if (!range) return rows;
    const [from, to] = range;
    return rows.filter((r) => {
      const date = parseDate(r.date);
      return date >= from && date <= to;
    });
  }, [rows, range]);

  const lanes = useMemo(() => buildLanes(rangedRows, groupBy), [rangedRows, groupBy]);
  const topExerciseIds = useMemo(
    () => new Set(groupBy === "exercise" ? lanes.filter((l) => l.id !== OTHER_ID).map((l) => Number(l.id)) : []),
    [lanes, groupBy],
  );
  const dayLaneHours = useMemo(
    () => buildDayLaneHours(rangedDays, rangedRows, lanes, groupBy, topExerciseIds),
    [rangedDays, rangedRows, lanes, groupBy, topExerciseIds],
  );

  const buckets = useMemo(() => groupByPeriod(rangedDays, period, (d) => d.date), [rangedDays, period]);

  // One InteractiveLine series per lane — average daily duration as the
  // line, mean ± 1 stddev as the (only-when-one-visible) band, and the
  // bucket's own sum + trained-day count folded into the tooltip label
  // rather than a separate row (same "extra context replaces the plain
  // label" convention the old single-line version already used).
  const series = useMemo<InteractiveLineSeries[]>(
    () =>
      lanes.map((lane) => {
        const points: InteractiveLinePoint[] = buckets.map(({ start, items }) => {
          const values = items.map((d) => dayLaneHours.get(d.date)?.[lane.id] ?? 0);
          const sum = values.reduce((a, b) => a + b, 0);
          const mean = sum / values.length;
          const dev = d3.deviation(values) ?? 0;
          return { x: parseDate(start), y: mean, bandLow: Math.max(0, mean - dev), bandHigh: mean + dev };
        });
        return {
          id: lane.id,
          label: lane.label,
          color: lane.color,
          points,
          band: true,
          markers: true,
          tooltipLabel: (_point, i) => {
            const items = buckets[i]?.items ?? [];
            const values = items.map((d) => dayLaneHours.get(d.date)?.[lane.id] ?? 0);
            const sum = values.reduce((a, b) => a + b, 0);
            const trainedDays = values.filter((v) => v > 0).length;
            if (trainedDays === 0) return `${lane.label} — no training logged`;
            return `${lane.label} — ${formatDuration(sum)} total, ${trainedDays} day${trainedDays === 1 ? "" : "s"}`;
          },
        };
      }),
    [lanes, buckets, dayLaneHours],
  );

  // Fixed, zero-floored y-domain (#411): duration is never negative, and
  // recomputed from the grouping/period/range that's actually chosen — so
  // switching "Break down by" rescales the axis to that view's own data,
  // rather than staying pinned whatever "None" happened to need.
  //
  // Sized off the *line* values only, deliberately excluding every lane's
  // band bounds — a single outlier training day (one long one-off hike)
  // lands entirely inside whichever single lane it belongs to, and that
  // lane's std-dev band balloons around it regardless of how many lanes
  // exist, even though only one lane's band is ever actually drawn at a
  // time (InteractiveLine only shows a band while exactly one line is
  // visible). Sizing the fixed axis to accommodate every lane's band *in
  // case* it gets isolated defeated the rescale entirely — every breakdown
  // inherited whichever lane had the single worst outlier. The generous
  // 30% headroom below is what keeps a genuinely isolated lane's own band
  // usually still fitting without a fixed axis reintroducing that problem;
  // an unusually wide band can still peek past the top, same tradeoff a
  // fixed axis on any chart implies.
  const yDomain = useMemo<[number, number]>(() => {
    const lineValues = series.flatMap((s) => s.points.map((p) => p.y));
    const max = d3.max(lineValues) ?? 1;
    return [0, max * 1.3 || 1];
  }, [series]);

  return (
    <ChartPage
      title="Exercise Trend"
      description="Average daily training duration over time, aggregated by period. Break it down by category or exercise, and toggle the legend down to one line to see its ±1 standard deviation band."
      info={{
        interactionGuide: LINE_INTERACTION_GUIDE,
        methodology: TRAINING_METHODOLOGY,
        trackingSpan: TRAINING_TRACKING_SPAN,
      }}
      filters={
        fullDomain ? (
          <>
            <GroupByPicker value={groupBy} onChange={setGroupBy} options={GROUP_BY_OPTIONS} label="Break down by" />
            <PeriodPicker value={period} onChange={setPeriod} />
            <TimeRangePicker domain={fullDomain} value={range} onChange={setRange} />
          </>
        ) : null
      }
    >
      <ChartCard empty={series.every((s) => s.points.length === 0)}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveLine
              series={series}
              width={width}
              height={height}
              yDomain={yDomain}
              valueFormat={formatDuration}
              dateFormat="monthYear"
              ariaLabel="Average daily training duration over time. Use the legend to isolate a category or exercise; arrow keys inspect individual buckets."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
