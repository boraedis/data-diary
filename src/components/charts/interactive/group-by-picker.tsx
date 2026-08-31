"use client";

import { Button } from "@/components/ui/button";

// GroupByPicker — a shared, fully generic "which dimension are the bands/
// series/bars right now" control (#19's "core tools" ask, covering the
// drill-down half of that request: "exercise level or sub level or
// focus"). Deliberately knows nothing about exercises, categories, or any
// specific domain — it's `<T extends string>` over whatever dimension ids
// the caller defines, so the same component serves an exercise chart's
// "Category / Exercise / Subtype" and, later, an entirely different
// chart's own drill-down levels, without this file changing.
//
// The actual re-grouping logic (re-tallying already-fetched rows by
// whichever dimension is selected) lives with the caller's own data, the
// same way TimeRangePicker leaves date-range resolution to its caller —
// this component only reports *which* dimension is picked.
//
// `label` now also renders as a visible section heading above the button
// row, not just an aria-label — per feedback that several of these next
// to each other in a filters row read as one undifferentiated block.
export type GroupByOption<T extends string> = { id: T; label: string };

export function GroupByPicker<T extends string>({
  value,
  onChange,
  options,
  label = "Group by",
  className,
}: {
  value: T;
  onChange: (id: T) => void;
  options: GroupByOption<T>[];
  label?: string;
  className?: string;
}) {
  if (options.length < 2) return null;

  return (
    <div role="group" aria-label={label} className={className}>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          {options.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="xs"
              variant={value === opt.id ? "secondary" : "ghost"}
              aria-pressed={value === opt.id}
              onClick={() => onChange(opt.id)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
