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

export type Period = "week" | "month" | "quarter" | "year";

export type PeriodBucket<T> = {
  /** Sortable, human-meaningful bucket id: the ISO Monday for "week"
   * ("2026-02-09"), "YYYY-MM" for "month" (matches the shape existing
   * chart data already used before this helper existed, e.g.
   * MonthlyAverage.month/WorkoutMonth.month in src/lib/charts.ts),
   * "YYYY-Qn" for "quarter", or plain "YYYY" for "year" (added for #19's
   * PeriodPicker — the first caller to need yearly bucketing). */
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
    case "year": {
      const key = dateStr.slice(0, 4);
      return { key, start: `${key}-01-01` };
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

// --- Cyclical folding (#451) ----------------------------------------------
//
// `groupByPeriod` walks forward through calendar time; these fold every year
// (or week) onto one repeating axis instead — Mon–Sun, Jan–Dec, or day
// 1–366 — so a chart can answer "am I happier on Fridays" or "do I sleep less
// in winter". Same boundary as the rest of this module: re-shaping rows a page
// already fetched, not bulk aggregation.
//
// Each position is placed on a *reference date* in the year 2000 rather than
// handed out as a bare index, so a fold can be drawn by the same time-scale
// primitive (`InteractiveLine`) as a timeline without that primitive growing
// a second, numeric x mode. 2000 is chosen for two properties: it's a leap
// year, so Feb 29 has its own day-of-year slot and March 1st is day 61 in
// every year (a plain 1–365 count would shift everything after February by a
// day in leap years, folding Mar 1 onto Feb 29); and 2000-01-03 is a Monday,
// so the week fold's seven reference days are consecutive, Monday first. The
// reference year itself never reaches the screen — callers format these
// dates with `formatCyclePosition`, which names only the weekday/month/day.

export type Cycle = "weekday" | "monthOfYear" | "dayOfYear";

/** How many positions each cycle has — also the modulus `poolCircularWindow`
 * wraps at. */
export const CYCLE_LENGTH: Record<Cycle, number> = { weekday: 7, monthOfYear: 12, dayOfYear: 366 };

// Day-of-year offset of each month's 1st in a leap year.
const LEAP_MONTH_OFFSETS = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

export type CycleBucket<T> = {
  /** 0-based slot in the cycle: Monday = 0, January = 0, Jan 1 = 0. */
  position: number;
  /** The position's reference date ("YYYY-MM-DD" in the year 2000) — see
   * this section's header for why a date rather than just `position`. */
  start: string;
  items: T[];
};

export function cyclePosition(cycle: Cycle, dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  switch (cycle) {
    case "weekday":
      return (new Date(year, month - 1, day).getDay() + 6) % 7; // Sun (0) -> 6, Mon (1) -> 0
    case "monthOfYear":
      return month - 1;
    case "dayOfYear":
      return LEAP_MONTH_OFFSETS[month - 1] + day - 1;
  }
}

export function cycleReferenceDate(cycle: Cycle, position: number): string {
  switch (cycle) {
    case "weekday":
      return addDays("2000-01-03", position);
    case "monthOfYear":
      return `2000-${String(position + 1).padStart(2, "0")}-01`;
    case "dayOfYear":
      return addDays("2000-01-01", position);
  }
}

/** The one occurrence of a cycle position a date belongs to — "2024-01" for
 * January 2024 under the month fold, the date itself under the day folds.
 * A summed series folds by averaging these occurrences' totals ("a typical
 * January's total"): summing every January across the whole history would
 * just grow with the number of years logged. */
export function cycleOccurrenceKey(cycle: Cycle, dateStr: string): string {
  return cycle === "monthOfYear" ? dateStr.slice(0, 7) : dateStr;
}

/**
 * Folds `items` onto a cycle's positions, sorted by position. Only positions
 * with at least one item are returned — a gap stays a gap, the same as an
 * empty period under `groupByPeriod`.
 */
export function foldByCycle<T>(items: T[], cycle: Cycle, getDate: (item: T) => string): CycleBucket<T>[] {
  const buckets = new Map<number, CycleBucket<T>>();
  for (const item of items) {
    const position = cyclePosition(cycle, getDate(item));
    const existing = buckets.get(position);
    if (existing) existing.items.push(item);
    else buckets.set(position, { position, start: cycleReferenceDate(cycle, position), items: [item] });
  }
  return [...buckets.values()].sort((a, b) => a.position - b.position);
}

/**
 * Widens each position to also hold every item within `radius` positions of
 * it, wrapping around the cycle's end (Dec 28 pools with Jan 3). This is the
 * day-of-year fold's smoothing: a single calendar day has only one value per
 * year logged, so 366 raw means are mostly noise. Pooling the *items* rather
 * than averaging the neighbouring means keeps the downstream mean and spread
 * honest — each day counts once per window, however many days share its
 * slot, and the band is the real spread of the pooled days. A position is
 * returned wherever its window holds anything, so a short history's edges
 * fill in from their neighbours rather than stopping dead.
 */
export function poolCircularWindow<T>(buckets: CycleBucket<T>[], cycle: Cycle, radius: number): CycleBucket<T>[] {
  const length = CYCLE_LENGTH[cycle];
  const byPosition = new Map(buckets.map((b) => [b.position, b.items]));
  const pooled: CycleBucket<T>[] = [];
  for (let position = 0; position < length; position++) {
    const items: T[] = [];
    for (let offset = -radius; offset <= radius; offset++) {
      const neighbour = byPosition.get((((position + offset) % length) + length) % length);
      if (neighbour) items.push(...neighbour);
    }
    if (items.length > 0) pooled.push({ position, start: cycleReferenceDate(cycle, position), items });
  }
  return pooled;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Names a reference date from `cycleReferenceDate` without its year — the
 * fold's own axis and tooltip labels. `short` is for axis ticks ("Mon",
 * "Jan", "Jan 1"), the long form for tooltip titles ("Monday", "January",
 * "January 1"). Built from fixed English names rather than
 * `toLocaleDateString`, whose weekday for a year-2000 date would be right
 * but whose month/day order and abbreviations vary by locale in ways the
 * rest of a fold's labels (and its tests) can't predict.
 */
export function formatCyclePosition(cycle: Cycle, dateStr: string, short = false): string {
  const position = cyclePosition(cycle, dateStr);
  const trim = (name: string) => (short ? name.slice(0, 3) : name);
  switch (cycle) {
    case "weekday":
      return trim(WEEKDAY_NAMES[position]);
    case "monthOfYear":
      return trim(MONTH_NAMES[position]);
    case "dayOfYear": {
      const [, month, day] = dateStr.split("-").map(Number);
      return `${trim(MONTH_NAMES[month - 1])} ${day}`;
    }
  }
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
