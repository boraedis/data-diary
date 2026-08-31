"use client";

import { Button } from "@/components/ui/button";
import type { Period } from "@/lib/viz/bin";

// PeriodPicker — a shared, chart-agnostic control for how a time-series
// chart buckets its x-axis (week/month/quarter/year), built for #19's
// "core tools" ask: a period toggle is generically useful to any chart
// that buckets by date, not something worth re-inventing per chart. Pairs
// with viz/bin.ts's `groupByPeriod` — the caller re-buckets its own
// already-fetched rows with whatever `Period` this reports, per that
// module's own documented architecture (client-side re-bucketing of a
// series that's cheap to hold raw, not a server round-trip per click).

const PERIOD_LABELS: Record<Period, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const DEFAULT_PERIODS: Period[] = ["week", "month", "quarter", "year"];

export function PeriodPicker({
  value,
  onChange,
  periods = DEFAULT_PERIODS,
  className,
}: {
  value: Period;
  onChange: (period: Period) => void;
  /** Restrict to a subset — e.g. a chart with only a few months of
   * history might omit "year". Defaults to all four. */
  periods?: Period[];
  className?: string;
}) {
  return (
    <div role="group" aria-label="Bucket by" className={className}>
      <div className="flex items-center gap-1">
        {periods.map((p) => (
          <Button
            key={p}
            type="button"
            size="xs"
            variant={value === p ? "secondary" : "ghost"}
            aria-pressed={value === p}
            onClick={() => onChange(p)}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>
    </div>
  );
}
