"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate } from "@/lib/date";
import type { TrainingMonth } from "@/lib/charts";

/**
 * Days trained per month.
 *
 * Not a `MonthlyAverageChart`: this is a count per month, not a mean of
 * daily values, so it has no meaningful min/max band and its marker size
 * would encode the same thing as its height.
 *
 * The exercise count sits in the tooltip rather than being a second
 * plotted series. Days trained is capped at ~31 a month while exercises
 * run into the hundreds, so sharing one axis would flatten the days line
 * to nothing — and a second y-axis is the one thing this repo's charts
 * never do (see #14's locked-in decisions, and the gym chart's documented
 * status as the single deliberate exception).
 */
export function TrainingVolumeChart({ data }: { data: TrainingMonth[] }) {
  const points = useMemo<InteractiveLinePoint[]>(
    () => data.map((d) => ({ x: parseDate(`${d.month}-01`), y: d.daysTrained })),
    [data],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveLine
          series={[
            {
              id: "training",
              label: "Days trained",
              color: categoricalColor(1),
              points,
              markers: () => 3,
              tooltipLabel: (_point, i) => {
                const exercises = data[i]?.exercises ?? 0;
                return `${exercises} exercise${exercises === 1 ? "" : "s"}`;
              },
            },
          ]}
          width={width}
          height={height}
          valueFormat={(v) => `${Math.round(v)} days`}
          dateFormat="monthYear"
          ariaLabel="Days trained each month. Use arrow keys to inspect individual months, or hover a point."
        />
      )}
    </ResponsiveChart>
  );
}
