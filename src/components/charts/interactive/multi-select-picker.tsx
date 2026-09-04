"use client";

import { Button } from "@/components/ui/button";

// MultiSelectPicker — the multi-select sibling of GroupByPicker (that one's
// single-select "which one dimension is active right now"; this is "which
// subset of these are currently shown"). Built for #117's weight chart
// (independently toggle Weight/Body fat/Muscle mass, all plotted at once),
// but domain-agnostic like every other picker in this folder — a caller
// reports back the full new set of selected ids on every toggle, same
// controlled, no-internal-state shape as GroupByPicker/PeriodPicker.

export type MultiSelectOption<T extends string> = { id: T; label: string };

export function MultiSelectPicker<T extends string>({
  values,
  onChange,
  options,
  label,
  className,
  minSelected = 0,
}: {
  values: T[];
  onChange: (values: T[]) => void;
  options: MultiSelectOption<T>[];
  label?: string;
  className?: string;
  /** Refuses to toggle an option off once exactly this many remain
   * selected — pass 1 for a picker whose caller has nothing to show at
   * zero (e.g. a chart's own series-visibility toggle, where "nothing
   * selected" reads as broken rather than as a valid filter state).
   * Defaults to 0 (no minimum) — a picker filtering optional overlays
   * (region types, say) has a perfectly valid "none shown" state. */
  minSelected?: number;
}) {
  if (options.length < 2) return null;

  function toggle(id: T) {
    if (values.includes(id)) {
      if (values.length <= minSelected) return;
      onChange(values.filter((v) => v !== id));
    } else {
      // Re-derived from `options`' own order rather than appended at the
      // end, so toggling doesn't reorder an already-visible series' own
      // legend/draw order out from under it.
      onChange(options.map((o) => o.id).filter((optId) => optId === id || values.includes(optId)));
    }
  }

  return (
    <div role="group" aria-label={label} className={className}>
      <div className="flex flex-col gap-1">
        {label ? <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span> : null}
        <div className="flex items-center gap-1">
          {options.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="xs"
              variant={values.includes(opt.id) ? "secondary" : "ghost"}
              aria-pressed={values.includes(opt.id)}
              onClick={() => toggle(opt.id)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
