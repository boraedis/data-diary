"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import { parseDate } from "@/lib/date";
import type { TrainingMonth } from "@/lib/charts";

/**
 * Hours trained per month.
 *
 * Not a `MonthlyAverageChart`: this is a total per month, not a mean of
 * daily values, so it has no meaningful min/max band and its marker size
 * would encode the same thing as its height.
 *
 * Days trained and exercise count sit in the tooltip rather than as extra
 * plotted series — tens of hours, ~31 days and hundreds of exercises are
 * three different scales, and a second y-axis is the one thing this repo's
 * charts never do (see #14's locked-in decisions, and the gym chart's
 * documented status as the single deliberate exception). Keeping them on
 * hover also answers the "sum or average" question in one chart: the line
 * is the month's total, and the tooltip's per-session average is the same
 * data read the other way.
 */
export function TrainingVolumeChart({ data }: { data: TrainingMonth[] }) {
  const points = useMemo<InteractiveLinePoint[]>(
    () => data.map((d) => ({ x: parseDate(`${d.month}-01`), y: d.minutes / 60 })),
    [data],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveLine
          series={[
            {
              id: "training",
              label: "Hours trained",
              color: categoricalColor(1),
              points,
              markers: () => 3,
              tooltipLabel: (_point, i) => {
                const month = data[i];
                if (!month || month.exercises === 0) return "no training logged";
                const average = Math.round(month.minutes / month.exercises);
                return `${month.daysTrained} day${month.daysTrained === 1 ? "" : "s"}, ${month.exercises} exercise${month.exercises === 1 ? "" : "s"}, ~${average} min each`;
              },
            },
          ]}
          width={width}
          height={height}
          valueFormat={(v) => formatDuration(v)}
          dateFormat="monthYear"
          ariaLabel="Hours trained each month. Use arrow keys to inspect individual months, or hover a point."
        />
      )}
    </ResponsiveChart>
  );
}
