"use client";

import * as d3 from "d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveHist } from "@/components/charts/interactive/interactive-hist";

/** Happiness distribution — 10-wide buckets over the fixed 0-100 scale,
 * rather than d3.bin's own auto-picked Sturges count, since a domain-
 * meaningful bucket width (one bucket per 10 points) reads better here
 * than a data-dependent one. Now a thin wrapper around the shared
 * InteractiveHist primitive (#20) instead of its own bespoke Histogram
 * implementation. */
export function HistogramChart({ values }: { values: number[] }) {
  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveHist
          values={values}
          width={width}
          height={height}
          domain={[0, 100]}
          thresholds={d3.range(0, 101, 10)}
          xTicks={10}
          ariaLabel="Happiness distribution histogram. Hover a bar to see its range and count."
        />
      )}
    </ResponsiveChart>
  );
}
