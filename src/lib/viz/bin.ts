import { addDays } from "@/lib/date";

// Shared client-side grouping/binning helper (#16's "binning/grouping
// helpers" scope item).
//
// Decision (documented per #16's acceptance criteria): bulk aggregation
// across a chart's FULL history belongs in SQL — date_trunc + GROUP BY —
// per project memory rebuild-decisions.md's chart-compute-strategy
// decision ("write aggregations as SQL first, only add materialized views
// if still slow"). This module is deliberately NOT that: it's for
// re-bucketing a series that's already been fetched (e.g. re-grouping by
// the user's current zoom window, or a small table like `days` where
// pulling raw rows and grouping client-side is already cheap and a second
// SQL round-trip per zoom change would be the slower path) — the exact
// carve-out #16 calls out ("re-bucketing an already-fetched series").
//
// Before this module, that need was met by two separate hand-rolled
// `Map<string, ...>` blocks in src/lib/charts.ts
// (getHappinessAveragerData, getGymWeightComboData) — real duplication of
// the same "bucket by month" logic, the small-scale version of legacy's
// ~300-line sleep_averager.js Averager pattern (which did weekly/monthly/
// quarterly bucketing per chart file, by hand, every time). Both of those
// call sites now use groupByPeriod (see #16 PR) instead of repeating the
// Map bookkeeping. Plain calendar-date arithmetic throughout, via
// src/lib/date.ts's addDays — no epoch-day math (see format.ts's header
// note for why that legacy pattern doesn't port).

export type Period = "week" | "month" | "quarter";

export type PeriodBucket<T> = {
  /** Sortable, human-meaningful bucket id: the ISO Monday for "week"
   * ("2026-02-09"), "YYYY-MM" for "month" (matches the shape existing
   * chart data already used before this helper existed, e.g.
   * MonthlyAverage.month/WorkoutMonth.month in src/lib/charts.ts), or
   * "YYYY-Qn" for "quarter". */
  key: string;
  /** The bucket's first calendar day, always "YYYY-MM-DD" regardless of
   * `period` — for callers that want to sort/format buckets uniformly
   * without branching on period the way `key` requires. */
  start: string;
  items: T[];
};

function startOfWeek(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const isoWeekday = new Date(year, month - 1, day).getDay() || 7; // Sun (0) -> 7
  return addDays(dateStr, -(isoWeekday - 1)); // back up to Monday
}

function bucketFor(period: Period, dateStr: string): { key: string; start: string } {
  switch (period) {
    case "week": {
      const start = startOfWeek(dateStr);
      return { key: start, start };
    }
    case "month": {
      const key = dateStr.slice(0, 7);
      return { key, start: `${key}-01` };
    }
    case "quarter": {
      const [yearStr, monthStr] = dateStr.split("-");
      const year = Number(yearStr);
      const quarter = Math.floor((Number(monthStr) - 1) / 3) + 1;
      const startMonth = (quarter - 1) * 3 + 1;
      return { key: `${year}-Q${quarter}`, start: `${year}-${String(startMonth).padStart(2, "0")}-01` };
    }
  }
}

/**
 * Groups `items` into week/month/quarter buckets by a date field, sorted
 * oldest-first. One shared, tested function in place of a per-chart
 * hand-rolled `Map` (see this module's header for which two call sites
 * this replaced first).
 */
export function groupByPeriod<T>(items: T[], period: Period, getDate: (item: T) => string): PeriodBucket<T>[] {
  const buckets = new Map<string, PeriodBucket<T>>();
  for (const item of items) {
    const { key, start } = bucketFor(period, getDate(item));
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      buckets.set(key, { key, start, items: [item] });
    }
  }
  return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export type PeriodSummary = { key: string; start: string; avg: number; count: number };

/** Average + sample count per bucket — the shape both of #16's ported
 * call sites need (a month with 2 entries and a month with 30 shouldn't
 * look equally confident; see getHappinessAveragerData's own comment on
 * why `count` travels alongside `avg`). */
export function summarizePeriods<T>(buckets: PeriodBucket<T>[], getValue: (item: T) => number): PeriodSummary[] {
  return buckets.map(({ key, start, items }) => ({
    key,
    start,
    avg: items.reduce((sum, item) => sum + getValue(item), 0) / items.length,
    count: items.length,
  }));
}
