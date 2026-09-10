"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveArea,
  type InteractiveAreaCategory,
  type InteractiveAreaMode,
  type InteractiveAreaPoint,
} from "@/components/charts/interactive/interactive-area";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { parseDate } from "@/lib/date";
import { AREA_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

/**
 * "What was this made up of, over time" — a stacked area with a share/count
 * toggle and a bucket picker.
 *
 * The shape behind a whole cluster of the chart backlog (#209): sleep
 * locations, who you saw, where you were, entertainment by medium, music by
 * artist. All of them are the same question asked of different tables, and
 * all of them hit the same two problems, which is why this exists rather
 * than each chart solving them again:
 *
 * 1. **The palette runs out.** Five real categorical slots before it
 *    flattens to one muted grey, against domains with hundreds of members
 *    (689 distinct people). Callers fold a tail into "Other" before passing
 *    categories in — this component doesn't guess how, because what's worth
 *    keeping differs per domain.
 * 2. **Colour must follow the entity, not its rank.** Slots are resolved
 *    once from the `categories` array, so a category keeps its colour when
 *    the bucket size changes or a filter removes its neighbours.
 *
 * The caller supplies one row per day with a value per category id, and
 * this buckets them. Bucketing here rather than in SQL is what makes the
 * period picker possible at all — the same split `src/lib/viz/bin.ts`
 * describes.
 */
export type CompositionRow = { date: string; values: Record<string, number> };

const MODE_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "proportional", label: "Share" },
  { id: "stacked", label: "Count" },
];

export function CompositionExplorer({
  rows,
  categories,
  title,
  description,
  methodology,
  valueFormat,
  extraFilters,
  initialPeriod = "month",
  ariaLabel,
}: {
  rows: CompositionRow[];
  categories: InteractiveAreaCategory[];
  title: string;
  description: string;
  /** Per-chart methodology copy for the `ChartInfo` popup — see #316.
   * Falls back to a visible placeholder when omitted. */
  methodology?: string;
  valueFormat: (value: number) => string;
  /** Extra controls rendered before the built-in ones. The caller owns
   * their state and reshapes `rows` accordingly. */
  extraFilters?: React.ReactNode;
  /** Starting bucket size. Month suits most of these; a chart whose signal
   * is week-to-week says so. */
  initialPeriod?: Period;
  ariaLabel: string;
}) {
  const [mode, setMode] = useState<InteractiveAreaMode>("proportional");
  const [period, setPeriod] = useState<Period>(initialPeriod);

  const points = useMemo<InteractiveAreaPoint[]>(
    () =>
      groupByPeriod(rows, period, (row) => row.date).map(({ start, items }) => {
        const values: Record<string, number> = {};
        for (const row of items) {
          for (const [id, value] of Object.entries(row.values)) {
            values[id] = (values[id] ?? 0) + value;
          }
        }
        return { x: parseDate(start), values };
      }),
    [rows, period],
  );

  return (
    <ChartPage
      title={title}
      description={description}
      info={{ interactionGuide: AREA_INTERACTION_GUIDE, methodology }}
      filters={
        <>
          {extraFilters}
          <GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="Show" />
          <PeriodPicker value={period} onChange={setPeriod} />
        </>
      }
    >
      <ChartCard empty={points.length === 0}>
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
          {({ width, height }) => (
            <InteractiveArea
              categories={categories}
              points={points}
              width={width}
              height={height}
              mode={mode}
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

/**
 * Ranks category keys by total weight, keeps the top `max`, and folds the
 * rest into one "Other" bucket.
 *
 * Exported because every consumer of the explorer needs it and the rule
 * should be identical across them: rank by overall total, not by
 * within-bucket presence, so a category's slot doesn't move when the
 * bucketing changes.
 */
export const OTHER_ID = "__other__";

export function foldToTopCategories(
  totals: Map<string, number>,
  max: number,
): { categories: InteractiveAreaCategory[]; keep: Set<string> } {
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const keep = new Set(ranked.slice(0, max));
  const categories: InteractiveAreaCategory[] = ranked
    .slice(0, max)
    .map((id) => ({ id, label: id }));
  if (ranked.length > max) categories.push({ id: OTHER_ID, label: "Other" });
  return { categories, keep };
}
