"use client";

import { Button } from "@/components/ui/button";
import type { PrevalenceWindow } from "@/lib/viz/prevalence";

// RelativeRangePicker — "the last week / month / year, or everything",
// each window ending today (#590). A sibling of TimeRangePicker rather than
// an extension of it: that one is a dual-handle slider over the data's own
// extent, for exploring an arbitrary stretch of history, and a "last 7
// days" preset doesn't fit a slider's model (its thumbs would have to jump
// to today and stay pinned there). Same label-above-buttons shape as
// PeriodPicker, so a row of these controls reads the same everywhere.

const OPTIONS: { id: PrevalenceWindow; label: string }[] = [
  { id: "all", label: "All" },
  { id: "1y", label: "1Y" },
  { id: "1m", label: "1M" },
  { id: "1w", label: "1W" },
];

export function RelativeRangePicker({
  value,
  onChange,
  label = "Window",
  className,
}: {
  value: PrevalenceWindow;
  onChange: (value: PrevalenceWindow) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={className}>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex flex-wrap items-center gap-1">
          {OPTIONS.map((opt) => (
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
