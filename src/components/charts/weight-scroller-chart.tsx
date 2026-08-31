"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate } from "@/lib/date";
import type { WeightPoint } from "@/lib/charts";

/** A zoomable weight-over-time line: drag on the strip below the chart to
 * zoom the main plot into that range, click (no drag) to reset — the
 * legacy app's "scroller" pattern (functions/views/vis/vis_functions.js's
 * Scroller). Now a thin wrapper around the shared InteractiveLine
 * primitive (#18) instead of its own bespoke MainLine/Overview
 * implementation — the brush-to-zoom behavior itself lives in
 * InteractiveLine now, generalized from what this component originally
 * built it for. */
export function WeightScrollerChart({ data }: { data: WeightPoint[] }) {
  const points = useMemo<InteractiveLinePoint[]>(
    () => data.map((d) => ({ x: parseDate(d.date), y: d.weightKg })),
    [data],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveLine
          series={[
            {
              id: "weight",
              label: "Weight",
              color: categoricalColor(0),
              points,
              // Markers off past 150 points — same threshold the pre-#18
              // implementation used, since a dense daily series reads
              // better as a clean line than a wall of overlapping dots.
              markers: points.length < 150,
            },
          ]}
          width={width}
          height={height}
          zoom="brush"
          valueFormat={(v) => `${v} kg`}
          yTickFormat={(d) => `${d} kg`}
          ariaLabel="Body weight over time. Use arrow keys to inspect individual entries, or hover a point."
        />
      )}
    </ResponsiveChart>
  );
}
