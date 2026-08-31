"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveHist } from "@/components/charts/interactive/interactive-hist";
import { categoricalColor } from "@/lib/viz/color";

// Padding (in points) added on each side of the data's own min/max before
// clipping back to the happiness scale's real bounds [0, 100] — enough to
// keep the outermost bars from looking flush against the axis edge
// without dragging in a long stretch of empty, bucket-less range.
const AXIS_PADDING = 3;

/** Happiness distribution — one bucket per whole point (buckets of 10
 * read as too coarse; every integer value gets its own bar) over just the
 * range of values actually logged, not the full fixed 0-100 scale, so the
 * chart doesn't spend most of its width on buckets nobody has an entry
 * in. Now a thin wrapper around the shared InteractiveHist primitive
 * (#20) instead of its own bespoke Histogram implementation. */
export function HistogramChart({ values }: { values: number[] }) {
  const { domain, thresholds } = useMemo(() => {
    if (values.length === 0) {
      return { domain: [0, 100] as [number, number], thresholds: d3.range(0, 101, 1) };
    }
    const [min, max] = d3.extent(values) as [number, number];
    const lo = Math.max(0, Math.floor(min) - AXIS_PADDING);
    const hi = Math.min(100, Math.ceil(max) + AXIS_PADDING);
    return { domain: [lo, hi] as [number, number], thresholds: d3.range(lo, hi + 1, 1) };
  }, [values]);

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveHist
          values={values}
          width={width}
          height={height}
          domain={domain}
          thresholds={thresholds}
          // Happiness charts are green — an explicit, deliberate choice
          // for this specific chart's identity (a single-series chart, not
          // a multi-series categorical assignment the dataviz skill's
          // fixed-slot-order rule governs), not the toolkit default. Same
          // choice made in happiness-averager-chart.tsx for the trend
          // line, so every "happiness" chart reads the same color.
          color={categoricalColor(2)}
          // Buckets of 1 already read as touching at most container
          // widths; let bars fill their slot rather than inheriting the
          // toolkit's 24px cap (meant for a handful of wide category
          // bars, not a dense per-point distribution).
          maxBarThickness={Infinity}
          barGap={1}
          countLabel={(n) => `day${n === 1 ? "" : "s"}`}
          ariaLabel="Happiness distribution histogram. Hover a bar to see its range and count."
        />
      )}
    </ResponsiveChart>
  );
}
