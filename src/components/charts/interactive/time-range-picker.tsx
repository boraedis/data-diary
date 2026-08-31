"use client";

import { useState } from "react";
import { Slider } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/viz/format";
import { toDateString } from "@/lib/date";

// TimeRangePicker — a shared, chart-agnostic dual-handle date range
// selector (#19's "core tools" ask). Replaces this file's original
// preset-button design ("3M"/"6M"/"1Y"/"All") per direct follow-up
// feedback: "the time range should be an actual range selector with a
// start and end, maybe something similar to the double range implemented
// in legacy." Legacy's own double-range source isn't present in this repo
// to port from, so this is a fresh build on `@base-ui/react`'s `Slider`
// primitive (already a project dependency, used elsewhere for `Button`),
// which natively supports a two-thumb range via an array value — no need
// to hand-roll thumb dragging/collision/keyboard handling.
//
// Deliberately still dumb about *why* a range matters, same as the old
// preset design: it only reports the committed `[start, end]` the user
// picked, bounded by whatever `domain` the caller passes (typically the
// data's own real extent, not "today" — a chart with no entries since
// March shouldn't default its slider to a mostly-empty last-12-months
// window). Values are epoch-ms under the hood (Slider only speaks
// numbers), always converted back to real `Date`s at the API boundary.

const DAY_MS = 24 * 60 * 60 * 1000;

export function TimeRangePicker({
  domain,
  value,
  onChange,
  label = "Time range",
  className,
}: {
  /** The full selectable extent — pass the data's own [earliest, latest]
   * date, not a fixed calendar range. */
  domain: [Date, Date];
  /** Currently committed [start, end], or `null` for "the full domain" —
   * `null` renders the thumbs at the domain's own edges. */
  value: [Date, Date] | null;
  onChange: (range: [Date, Date]) => void;
  label?: string;
  className?: string;
}) {
  const min = domain[0].getTime();
  const max = domain[1].getTime();
  const committed: [number, number] = [value ? value[0].getTime() : min, value ? value[1].getTime() : max];

  // Live position while actively dragging, kept separate from the
  // committed `value` — every intermediate pointermove firing the
  // caller's onChange would re-filter rows, re-stack, and fully rebuild
  // the chart's <svg> on every frame of the drag (see interactive-area.tsx
  // useD3's own comment on why that redraw is only cheap on a settled
  // change, not per pointermove). `onValueCommitted` — fired once, on
  // release — is what calls the caller's `onChange`; `onValueChange`
  // (continuous) only updates this local display state.
  const [live, setLive] = useState<[number, number]>(committed);
  const [dragging, setDragging] = useState(false);
  const shown = dragging ? live : committed;

  const disabled = min >= max;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Slider.Root
        aria-label={label}
        value={shown}
        onValueChange={(v) => {
          setDragging(true);
          setLive(v as [number, number]);
        }}
        onValueCommitted={(v) => {
          setDragging(false);
          const [start, end] = v as [number, number];
          onChange([new Date(start), new Date(end)]);
        }}
        min={min}
        max={max}
        step={DAY_MS}
        minStepsBetweenValues={1}
        disabled={disabled}
      >
        <Slider.Control className="flex w-36 items-center py-2.5 data-[disabled]:opacity-40">
          <Slider.Track className="relative h-1 w-full rounded-full bg-muted">
            <Slider.Indicator className="absolute h-full rounded-full bg-primary" />
            <Slider.Thumb
              index={0}
              getAriaLabel={() => "Range start"}
              className="block size-3.5 rounded-full border-2 border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Slider.Thumb
              index={1}
              getAriaLabel={() => "Range end"}
              className="block size-3.5 rounded-full border-2 border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>{formatDate(toDateString(new Date(shown[0])), "short")}</span>
        <span>{formatDate(toDateString(new Date(shown[1])), "short")}</span>
      </div>
    </div>
  );
}
