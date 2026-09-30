"use client";

import { useState } from "react";
import { Slider } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

// YearRangePicker — TimeRangePicker's whole-year sibling (#215). Same
// two-thumb @base-ui Slider and the same styling, so the two read as one
// family in a filters row, but its values are calendar years and it snaps
// to them: for a chart whose natural unit is the year, a day-precise range
// only invites "Mar 14, 2019 – Nov 2, 2023" selections nobody meant.
//
// Unlike TimeRangePicker, the two thumbs may meet: start = end is a
// single year, a real choice here rather than an empty range.
//
// Same commit-on-release split as TimeRangePicker (see its own comment):
// dragging only moves the thumbs and labels; the caller hears about the
// range once, when the thumb is let go.

export function YearRangePicker({
  domain,
  value,
  onChange,
  label = "Years",
  className,
}: {
  /** First and last selectable year, inclusive — the data's own extent. */
  domain: [number, number];
  value: [number, number];
  onChange: (range: [number, number]) => void;
  label?: string;
  className?: string;
}) {
  const [live, setLive] = useState<[number, number]>(value);
  const [dragging, setDragging] = useState(false);
  const shown = dragging ? live : value;
  const disabled = domain[0] >= domain[1];

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
          onChange(v as [number, number]);
        }}
        min={domain[0]}
        max={domain[1]}
        step={1}
        minStepsBetweenValues={0}
        disabled={disabled}
      >
        <Slider.Control className="flex w-44 items-center py-2.5 data-[disabled]:opacity-40">
          <Slider.Track className="relative h-1 w-full rounded-full bg-muted">
            <Slider.Indicator className="absolute h-full rounded-full bg-primary" />
            <Slider.Thumb
              index={0}
              getAriaLabel={() => "First year"}
              className="block size-3.5 rounded-full border-2 border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Slider.Thumb
              index={1}
              getAriaLabel={() => "Last year"}
              className="block size-3.5 rounded-full border-2 border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>{shown[0]}</span>
        <span>{shown[1]}</span>
      </div>
    </div>
  );
}
