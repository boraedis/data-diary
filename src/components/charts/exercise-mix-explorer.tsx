"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
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
import { formatDate } from "@/lib/viz/format";
import { EXERCISE_CATEGORY_LABELS, EXERCISE_CATEGORY_ORDER, type ExerciseWorkoutRow } from "@/lib/charts";

// ExerciseMixExplorer — the real InteractiveArea (#19) consumer, and the
// proving ground for #19's "core tools" ask: a period-granularity picker,
// a trailing time-range picker, and a group-by/drill-down picker, all
// built as genuinely shared components (interactive/period-picker.tsx,
// time-range-picker.tsx, group-by-picker.tsx) rather than bespoke UI
// wired up just for this one chart. This file is the domain-specific
// glue: it owns the interactive state, the client-side re-bucketing
// pipeline over the raw rows the server handed it, and renders the whole
// page body itself (title + filters row + chart card) rather than a page
// component splitting that across two places — see the note below on why.

// A real <button> toggle group reused for the stacked/proportional switch
// too, not just the exercise-specific dimensions below — GroupByPicker's
// whole point is being generic over *any* small fixed set of options.
const VIEW_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "stacked", label: "Count" },
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
// single free-text field) — clean partitions, so their per-bucket counts
// sum to the bucket's true total, which a stack requires. Focus is a
// many-to-many tag on the *exercise catalog entry* (exerciseFocusLinks —
// see schema.ts's own comment: "an exercise can carry more than one focus/
// subfocus pair"), so a workout whose exercise has two focus tags would
// get counted in *both* bands — summing by focus would overcount total
// workouts, not just re-slice them. Not included until there's a real
// answer for that (e.g. picking one "primary" focus per exercise) rather
// than shipping a stack that silently double-counts.

// Matches viz/color.ts's CATEGORICAL_SLOT_COUNT — beyond this many
// distinct values, the long tail folds into "Other" rather than the
// palette generating/cycling a 6th+ hue (the dataviz skill's fixed-order
// rule). "category" never hits this (exactly 3 values); "exercise" and
// "subtype" very well might once there's a real workout history.
const MAX_CATEGORIES = 5;
const OTHER_ID = "__other__";

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

/** The fixed set of bands for the current grouping dimension — computed
 * from total volume across every (already time-range-filtered) row, not
 * per-bucket, so a band's presence/color doesn't flicker per period. Only
 * "category" gets a truly fixed order (matches exerciseCategoryEnum);
 * "exercise"/"subtype" have no inherent order, so they're ranked by
 * volume — most-logged first, which is also what determines who survives
 * the top-5 cut before folding into "Other". */
function buildCategories(rows: ExerciseWorkoutRow[], dim: GroupByDimension): InteractiveAreaCategory[] {
  if (dim === "category") {
    return EXERCISE_CATEGORY_ORDER.map((id) => ({ id, label: EXERCISE_CATEGORY_LABELS[id] }));
  }
  const totals = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const { id, label } = dimensionKey(row, dim);
    const existing = totals.get(id);
    if (existing) existing.count += 1;
    else totals.set(id, { label, count: 1 });
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].count - a[1].count);
  const top: InteractiveAreaCategory[] = ranked.slice(0, MAX_CATEGORIES).map(([id, v]) => ({ id, label: v.label }));
  if (ranked.length > MAX_CATEGORIES) {
    top.push({ id: OTHER_ID, label: "Other", color: "var(--muted-foreground)" });
  }
  return top;
}

function buildPoints(
  rows: ExerciseWorkoutRow[],
  dim: GroupByDimension,
  period: Period,
  keptIds: ReadonlySet<string>,
): InteractiveAreaPoint[] {
  return groupByPeriod(rows, period, (r) => r.date).map(({ start, items }) => {
    const values: Record<string, number> = {};
    for (const row of items) {
      const { id } = dimensionKey(row, dim);
      const key = keptIds.has(id) ? id : OTHER_ID;
      values[key] = (values[key] ?? 0) + 1;
    }
    return { x: parseDate(start), values };
  });
}

/** formatDate's presets (viz/format.ts) have no shape for a quarter or a
 * bare year, since neither is an Intl.DateTimeFormatOptions concept — this
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
  // Months back from the data's own latest entry, or null for "all time"
  // — see time-range-picker.tsx's own comment on why it's anchored to the
  // data, not to today's real-world date.
  const [rangeMonths, setRangeMonths] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByDimension>("category");

  // Rows arrive oldest-first (the server query's own ORDER BY) — the
  // first/last entries are the extent directly, no need to scan for it.
  const fullDomainEnd = rows.length ? parseDate(rows[rows.length - 1].date) : null;

  const filteredRows = useMemo(() => {
    if (rangeMonths === null || !fullDomainEnd) return rows;
    const cutoff = new Date(fullDomainEnd.getFullYear(), fullDomainEnd.getMonth() - rangeMonths, fullDomainEnd.getDate());
    return rows.filter((r) => parseDate(r.date) >= cutoff);
  }, [rows, rangeMonths, fullDomainEnd]);

  const categories = useMemo(() => buildCategories(filteredRows, groupBy), [filteredRows, groupBy]);
  const keptIds = useMemo(
    () => new Set(categories.filter((c) => c.id !== OTHER_ID).map((c) => c.id)),
    [categories],
  );
  const points = useMemo(
    () => buildPoints(filteredRows, groupBy, period, keptIds),
    [filteredRows, groupBy, period, keptIds],
  );
  const titleFormat = useMemo(() => titleFormatterFor(period), [period]);

  return (
    <ChartPage
      title="Exercise mix"
      filters={
        <>
          <PeriodPicker value={period} onChange={setPeriod} />
          <TimeRangePicker value={rangeMonths} onChange={setRangeMonths} />
          <GroupByPicker value={groupBy} onChange={setGroupBy} options={GROUP_BY_OPTIONS} label="Group by" />
          <GroupByPicker value={mode} onChange={setMode} options={VIEW_OPTIONS} label="View" className="ml-auto" />
        </>
      }
    >
      <ChartCard
        title="Exercise mix"
        description="Workout count by category, exercise, or subtype — bucketed by week, month, quarter, or year. Click a legend entry to hide it."
        empty={rows.length === 0}
      >
        <ResponsiveChart className="h-[min(50vh,420px)]" minWidth={240}>
          {({ width, height }) => (
            <InteractiveArea
              categories={categories}
              points={points}
              width={width}
              height={height}
              mode={mode}
              valueFormat={(v) => `${v} workout${v === 1 ? "" : "s"}`}
              titleFormat={titleFormat}
              ariaLabel="Workouts over time, broken down by the selected grouping. Hover or use arrow keys to inspect a bucket, click a legend entry to hide a category."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
