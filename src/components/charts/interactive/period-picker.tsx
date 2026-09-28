"use client";

import { Button } from "@/components/ui/button";
import type { Cycle, Period } from "@/lib/viz/bin";

// PeriodPicker — a shared, chart-agnostic control for how a time-series
// chart buckets its x-axis (week/month/quarter/year), built for #19's
// "core tools" ask: a period toggle is generically useful to any chart
// that buckets by date, not something worth re-inventing per chart. Pairs
// with viz/bin.ts's `groupByPeriod` — the caller re-buckets its own
// already-fetched rows with whatever `Period` this reports, per that
// module's own documented architecture (client-side re-bucketing of a
// series that's cheap to hold raw, not a server round-trip per click).
//
// Renders a visible section label above the button row (not just an
// aria-label) — per feedback that a row of several of these controls next
// to each other read as "one big block" with no way to tell at a glance
// what each group of buttons does.
//
// Optional `cycles` (#451) add seasonal-fold buttons after the periods —
// Day of Week, Month of Year, Day of Year, paired with bin.ts's
// `foldByCycle`. They live on this same row rather than a picker of their
// own because to a reader they're one more answer to "bucket by what?";
// the caller still branches on which kind it got.

const PERIOD_LABELS: Record<Period, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const CYCLE_LABELS: Record<Cycle, string> = {
  weekday: "Day of Week",
  monthOfYear: "Month of Year",
  dayOfYear: "Day of Year",
};

const DEFAULT_PERIODS: Period[] = ["week", "month", "quarter", "year"];
const NO_CYCLES: Cycle[] = [];

export function PeriodPicker<V extends Period | Cycle = Period>({
  value,
  onChange,
  periods = DEFAULT_PERIODS,
  cycles = NO_CYCLES,
  label = "Bucket by",
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  /** Restrict to a subset — e.g. a chart with only a few months of
   * history might omit "year". Defaults to all four. */
  periods?: Period[];
  /** Seasonal folds to offer after the periods. Only pass these when
   * `onChange` accepts a `Cycle` too — the type parameter `V` should then
   * be `Period | Cycle`. Defaults to none. */
  cycles?: Cycle[];
  label?: string;
  className?: string;
}) {
  const options: { id: Period | Cycle; label: string }[] = [
    ...periods.map((p) => ({ id: p, label: PERIOD_LABELS[p] })),
    ...cycles.map((c) => ({ id: c, label: CYCLE_LABELS[c] })),
  ];
  return (
    <div role="group" aria-label={label} className={className}>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex flex-wrap items-center gap-1">
          {options.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="xs"
              variant={value === opt.id ? "secondary" : "ghost"}
              aria-pressed={value === opt.id}
              onClick={() => onChange(opt.id as V)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
