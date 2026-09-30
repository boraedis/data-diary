"use client";

import { useMemo } from "react";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveArea,
  type InteractiveAreaCategory,
  type InteractiveAreaPoint,
} from "@/components/charts/interactive/interactive-area";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { EXERCISE_CATEGORY_COLORS, EXERCISE_CATEGORY_LABELS, EXERCISE_CATEGORY_ORDER, type ExerciseWorkoutRow } from "@/lib/charts";
import { daysBetween, parseDate } from "@/lib/date";
import { categoricalColor } from "@/lib/viz/color";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { formatDuration } from "@/lib/viz/format";
import type { HappinessDay } from "@/lib/recap-health";

// The recap's happiness-trend and exercise-mix charts (#527, deferred from
// #201). Both are the same primitives and the same data as their /charts
// pages, minus the page shell and pickers: a recap is a fixed window, so
// there's no range or group-by to choose, and the reader can open the full
// chart page for that.
//
// The chart height class is the one every chart page uses (AGENTS.md).
const HEIGHT_CLASS = `h-[min(62vh,640px)] ${CHART_HEIGHT_CLASS}`;

/** A month of daily points is readable, a year of them is noise — weekly
 * buckets up to ~2 months, monthly beyond. Derived from the data's own
 * extent because the section isn't handed the period, and this keeps an
 * arbitrary window working the way `RecapPeriod` promises. */
const WEEKLY_MAX_SPAN_DAYS = 62;

function bucketFor(dates: string[]): Period {
  if (dates.length === 0) return "month";
  return daysBetween(dates[0], dates[dates.length - 1]) <= WEEKLY_MAX_SPAN_DAYS ? "week" : "month";
}

// The same slot HappinessTrendChart uses, so the recap's line reads as the
// same metric as the chart page's.
const HAPPINESS_COLOR = categoricalColor(2);

export function RecapHappinessTrend({ series, periodLabel }: { series: HappinessDay[]; periodLabel: string }) {
  const bucket = bucketFor(series.map((d) => d.date));
  const points = useMemo<InteractiveLinePoint[]>(
    () =>
      groupByPeriod(series, bucket, (d) => d.date).map(({ start, items }) => ({
        x: parseDate(start),
        y: items.reduce((total, d) => total + d.happiness, 0) / items.length,
      })),
    [series, bucket]
  );
  const lineSeries = useMemo(
    () => [
      {
        id: "happiness",
        label: "Happiness",
        color: HAPPINESS_COLOR,
        points,
        markers: true,
      },
    ],
    [points]
  );

  return (
    <ResponsiveChart className={HEIGHT_CLASS}>
      {({ width, height }) => (
        <InteractiveLine
          series={lineSeries}
          width={width}
          height={height}
          // Fixed 0-100 so a flat-looking year isn't stretched into drama.
          yDomain={[0, 100]}
          zoom="none"
          dateFormat={bucket === "week" ? "short" : "monthYear"}
          valueFormat={(v) => v.toFixed(1)}
          ariaLabel={`Average happiness by ${bucket} across ${periodLabel}. Use arrow keys to inspect individual points, or hover.`}
        />
      )}
    </ResponsiveChart>
  );
}

const CATEGORIES: InteractiveAreaCategory[] = EXERCISE_CATEGORY_ORDER.map((id) => ({
  id,
  label: EXERCISE_CATEGORY_LABELS[id],
  color: EXERCISE_CATEGORY_COLORS[id],
}));

export function RecapExerciseMix({ rows, periodLabel }: { rows: ExerciseWorkoutRow[]; periodLabel: string }) {
  const bucket = bucketFor(rows.map((r) => r.date));
  const points = useMemo<InteractiveAreaPoint[]>(
    () =>
      groupByPeriod(rows, bucket, (r) => r.date).map(({ start, items }) => {
        const values: Record<string, number> = {};
        for (const row of items) values[row.category] = (values[row.category] ?? 0) + row.hours;
        return { x: parseDate(start), values };
      }),
    [rows, bucket]
  );

  return (
    <ResponsiveChart className={HEIGHT_CLASS}>
      {({ width, height }) => (
        <InteractiveArea
          categories={CATEGORIES}
          points={points}
          width={width}
          height={height}
          mode="stacked"
          dateFormat={bucket === "week" ? "short" : "monthYear"}
          valueFormat={(hours) => formatDuration(hours)}
          ariaLabel={`Time spent exercising by category, by ${bucket}, across ${periodLabel}.`}
        />
      )}
    </ResponsiveChart>
  );
}
