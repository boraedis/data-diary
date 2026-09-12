"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveArea,
  type InteractiveAreaCategory,
  type InteractiveAreaMode,
  type InteractiveAreaPoint,
} from "@/components/charts/interactive/interactive-area";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { parseDate, toDateString } from "@/lib/date";
import { formatDate, formatDuration } from "@/lib/viz/format";
import { EXERCISE_CATEGORY_LABELS, EXERCISE_CATEGORY_ORDER, type ExerciseWorkoutRow } from "@/lib/charts";
import { AREA_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { TRAINING_METHODOLOGY } from "@/lib/viz/methodology";
import { TRAINING_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// ExerciseMixExplorer - the real InteractiveArea (#19) consumer, and the
// proving ground for #19's "core tools" ask: a period-granularity picker,
// a time-range picker, and a group-by/drill-down picker, all built as
// genuinely shared components (interactive/period-picker.tsx,
// time-range-picker.tsx, group-by-picker.tsx) rather than bespoke UI
// wired up just for this one chart. This file is the domain-specific
// glue: it owns the interactive state, the client-side re-bucketing
// pipeline over the raw rows the server handed it, and renders the whole
// page body itself (title + filters row + chart card) rather than a page
// component splitting that across two places - see the note below on why.

// A real <button> toggle group reused for the stacked/proportional switch
// too, not just the exercise-specific dimensions below - GroupByPicker's
// whole point is being generic over *any* small fixed set of options.
const VIEW_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "stacked", label: "Duration" },
  { id: "proportional", label: "% share" },
];

type GroupByDimension = "category" | "exercise" | "subtype";

const GROUP_BY_OPTIONS: GroupByOption<GroupByDimension>[] = [
  { id: "category", label: "Category" },
  { id: "exercise", label: "Exercise" },
  { id: "subtype", label: "Subtype" },
];

// NOTE on what's deliberately NOT a group-by option here: exercise focus/
// subfocus. Category and subtype are both single-valued per workout (a
// workout's exercise has exactly one category, and workouts.subtype is a
// single free-text field) - clean partitions, so their per-bucket duration
// sums add up to the bucket's true total, which a stack requires. Focus is
// a many-to-many tag on the *exercise catalog entry* (exerciseFocusLinks -
// see schema.ts's own comment: "an exercise can carry more than one focus/
// subfocus pair"), so a workout whose exercise has two focus tags would
// get its duration counted in *both* bands - summing by focus would
// overcount total time spent, not just re-slice it. Not included until
// there's a real answer for that (e.g. picking one "primary" focus per
// exercise) rather than shipping a stack that silently double-counts.

function dimensionKey(row: ExerciseWorkoutRow, dim: GroupByDimension): { id: string; label: string } {
  switch (dim) {
    case "category":
      return { id: row.category, label: EXERCISE_CATEGORY_LABELS[row.category] ?? row.category };
    case "exercise":
      return { id: String(row.exerciseId), label: row.exerciseName };
    case "subtype":
      return row.subtype ? { id: row.subtype, label: row.subtype } : { id: "__none__", label: "(none)" };
  }
}

/** The fixed set of bands for the current grouping dimension - computed
 * from total volume (duration, #334 - this used to be a plain workout
 * count) across every (already time-range-filtered) row, not per-bucket,
 * so a band's presence/color doesn't flicker per period. Only "category"
 * gets a truly fixed order (matches exerciseCategoryEnum); "exercise"/
 * "subtype" have no inherent order, so they're ranked by volume - most
 * time spent first.
 *
 * No top-N/"Other" cut here - every distinct value gets its own band, per
 * explicit follow-up feedback ("get rid of the other just put everything
 * on there"). Worth flagging honestly: viz/color.ts's categoricalColor()
 * only has 5 fixed slots (CATEGORICAL_SLOT_COUNT) before it falls back to
 * a single flat muted-gray for every slot beyond that - so once "exercise"
 * or "subtype" surfaces more than 5 distinct values, the 6th+ bands will
 * share that same gray and rely on the legend/tooltip/in-shape labels to
 * stay distinguishable rather than color. That's an existing, unmodified
 * property of the shared color scale, not something new to this chart -
 * extending the categorical palette itself is a separate, bigger decision
 * than what was asked for here.
 */
function buildCategories(rows: ExerciseWorkoutRow[], dim: GroupByDimension): InteractiveAreaCategory[] {
  if (dim === "category") {
    return EXERCISE_CATEGORY_ORDER.map((id) => ({ id, label: EXERCISE_CATEGORY_LABELS[id] }));
  }
  const totals = new Map<string, { label: string; hours: number }>();
  for (const row of rows) {
    const { id, label } = dimensionKey(row, dim);
    const existing = totals.get(id);
    if (existing) existing.hours += row.hours;
    else totals.set(id, { label, hours: row.hours });
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].hours - a[1].hours);
  return ranked.map(([id, v]) => ({ id, label: v.label }));
}

function buildPoints(rows: ExerciseWorkoutRow[], dim: GroupByDimension, period: Period): InteractiveAreaPoint[] {
  return groupByPeriod(rows, period, (r) => r.date).map(({ start, items }) => {
    const values: Record<string, number> = {};
    for (const row of items) {
      const { id } = dimensionKey(row, dim);
      values[id] = (values[id] ?? 0) + row.hours;
    }
    return { x: parseDate(start), values };
  });
}

/** formatDate's presets (viz/format.ts) have no shape for a quarter or a
 * bare year, since neither is an Intl.DateTimeFormatOptions concept - this
 * is InteractiveArea's `titleFormat` escape hatch for exactly that case,
 * one function per period rather than growing format.ts's preset table
 * for two chart-specific labels. */
function titleFormatterFor(period: Period): (x: Date) => string {
  switch (period) {
    case "week":
      return (x) => `Week of ${formatDate(toDateString(x), "short")}`;
    case "month":
      return (x) => formatDate(toDateString(x), "monthYear");
    case "quarter":
      return (x) => `Q${Math.floor(x.getMonth() / 3) + 1} ${x.getFullYear()}`;
    case "year":
      return (x) => String(x.getFullYear());
  }
}

export function ExerciseMixExplorer({ rows }: { rows: ExerciseWorkoutRow[] }) {
  const [mode, setMode] = useState<InteractiveAreaMode>("stacked");
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<GroupByDimension>("category");

  // Rows arrive oldest-first (the server query's own ORDER BY) - the
  // first/last entries are the extent directly, no need to scan for it.
  const fullDomain = useMemo<[Date, Date] | null>(() => {
    if (rows.length === 0) return null;
    return [parseDate(rows[0].date), parseDate(rows[rows.length - 1].date)];
  }, [rows]);

  // [start, end] within fullDomain, or null for "everything" - see
  // time-range-picker.tsx's own comment on why the committed value (not a
  // live drag position) is what drives this re-filter.
  const [range, setRange] = useState<[Date, Date] | null>(null);

  const filteredRows = useMemo(() => {
    if (!range) return rows;
    const [start, end] = range;
    return rows.filter((r) => {
      const d = parseDate(r.date);
      return d >= start && d <= end;
    });
  }, [rows, range]);

  const categories = useMemo(() => buildCategories(filteredRows, groupBy), [filteredRows, groupBy]);
  const points = useMemo(() => buildPoints(filteredRows, groupBy, period), [filteredRows, groupBy, period]);
  const titleFormat = useMemo(() => titleFormatterFor(period), [period]);

  return (
    <ChartPage
      title="Exercise Mix"
      description="A breakdown of how I exercised by time spent, aggregated by period."
      info={{
        interactionGuide: AREA_INTERACTION_GUIDE,
        methodology: TRAINING_METHODOLOGY,
        trackingSpan: TRAINING_TRACKING_SPAN,
      }}
      filters={
        <>
          <PeriodPicker value={period} onChange={setPeriod} />
          {fullDomain ? <TimeRangePicker domain={fullDomain} value={range} onChange={setRange} /> : null}
          <GroupByPicker value={groupBy} onChange={setGroupBy} options={GROUP_BY_OPTIONS} label="Group by" />
          <GroupByPicker value={mode} onChange={setMode} options={VIEW_OPTIONS} label="View" className="ml-auto" />
        </>
      }
    >
      <ChartCard empty={rows.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={240}>
          {({ width, height }) => (
            <InteractiveArea
              categories={categories}
              points={points}
              width={width}
              height={height}
              mode={mode}
              valueFormat={formatDuration}
              titleFormat={titleFormat}
              ariaLabel="Time spent exercising over time, broken down by the selected grouping. Hover or focus a band and use arrow keys to inspect it, click a legend entry to hide a category."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
