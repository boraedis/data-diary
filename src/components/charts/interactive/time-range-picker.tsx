"use client";

import { Button } from "@/components/ui/button";

// TimeRangePicker — a shared, chart-agnostic "trailing window" control
// (#19's "core tools" ask): "3M"/"6M"/"1Y"/"All"-style preset buttons for
// narrowing a chart to its most recent N months. Deliberately dumb about
// dates: it only reports which preset is selected (months back, or `null`
// for "all") — resolving that into an actual `[Date, Date]` range is left
// to the caller, since only the caller knows its own data's real extent.
// That split matters here specifically: these presets are meant to read
// as "the last N months of *my logged data*," not "the last N months of
// the calendar" — a chart with no entries since March shouldn't have its
// "3M" preset silently show nothing just because today's date rolled
// forward. The caller should anchor "N months back" against its own
// fullDomain's end, not `new Date()`.
//
// No custom/arbitrary range picker (two date inputs) yet — presets cover
// the common case, and a from/to picker is easy to add here later
// without changing this component's shape for existing callers.

export type TimeRangePreset = {
  label: string;
  /** Months back from the caller's own data extent, or `null` for every
   * point on record. */
  months: number | null;
};

export const DEFAULT_TIME_RANGE_PRESETS: TimeRangePreset[] = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "All", months: null },
];

export function TimeRangePicker({
  value,
  onChange,
  presets = DEFAULT_TIME_RANGE_PRESETS,
  className,
}: {
  /** Currently selected preset's `months` (or `null` for "All"). */
  value: number | null;
  onChange: (months: number | null) => void;
  presets?: TimeRangePreset[];
  className?: string;
}) {
  return (
    <div role="group" aria-label="Time range" className={className}>
      <div className="flex items-center gap-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            size="xs"
            variant={value === preset.months ? "secondary" : "ghost"}
            aria-pressed={value === preset.months}
            onClick={() => onChange(preset.months)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
