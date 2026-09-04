"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveScroller, type InteractiveScrollerSeries } from "@/components/charts/interactive/interactive-scroller";
import { parseDate } from "@/lib/date";
import type { WeightPoint } from "@/lib/charts";

/** First real consumer of InteractiveScroller (#117) — weight is exactly
 * this primitive's use case (raw daily density, not a pre-bucketed
 * series), unlike InteractiveLine's grouped/aggregated shape this chart
 * used before. Direct zoom (scroll or drag on the plot itself) + a
 * synced minimap with its own brush replace the old brush-only overview
 * strip. */
export function WeightScrollerChart({ data }: { data: WeightPoint[] }) {
  const series = useMemo<InteractiveScrollerSeries[]>(
    () => [
      {
        id: "weight",
        label: "Weight",
        movingAverage: true,
        points: data.map((d) => ({ x: parseDate(d.date), y: d.weightKg })),
      },
    ],
    [data],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveScroller
          series={series}
          width={width}
          height={height}
          // toFixed(1), not the raw float — a moving average sums plain
          // floats over an expanding/sliding window, so it accumulates
          // binary-fraction noise (e.g. "75.998333333333339") that a
          // logged weight value itself never has.
          valueFormat={(v) => `${v.toFixed(1)} kg`}
          yTickFormat={(d) => `${d} kg`}
          ariaLabel="Body weight over time. Use arrow keys to inspect individual entries, or hover a point."
        />
      )}
    </ResponsiveChart>
  );
}
