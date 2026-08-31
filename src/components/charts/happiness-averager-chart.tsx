"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate } from "@/lib/date";
import type { MonthlyAverage } from "@/lib/charts";

/** Monthly average happiness, one point per month sized by how many days
 * fed it, with a shaded band showing that month's actual day-to-day
 * range — the legacy "Averager" pattern (functions/views/vis/charts/
 * happiness_averager.js), which bins a noisy day-by-day signal down to a
 * readable trend line rather than plotting every raw point (that's what
 * /charts/happiness's histogram and the weight scroller's dense-line mode
 * are for instead). Now a thin wrapper around the shared InteractiveLine
 * primitive (#18) instead of its own bespoke Averager implementation. */
export function HappinessAveragerChart({ data }: { data: MonthlyAverage[] }) {
  const points = useMemo<InteractiveLinePoint[]>(
    () =>
      data.map((d) => ({
        x: parseDate(`${d.month}-01`),
        y: d.avg,
        bandLow: d.min,
        bandHigh: d.max,
      })),
    [data],
  );

  // Marker radius scales with how many days fed that month's average — a
  // month averaged from 30 entries reads as more confident than one
  // averaged from 2. Keyed by index into `data` (not a field on the point
  // itself — InteractiveLinePoint has no room for arbitrary per-point
  // extras, so this closes over the parallel `data` array instead, same
  // order as `points`).
  const radiusScale = useMemo(
    () =>
      d3
        .scaleSqrt()
        .domain([0, d3.max(data, (d) => d.count) ?? 1])
        .range([1.5, 5]),
    [data],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
      {({ width, height }) => (
        <InteractiveLine
          series={[
            {
              id: "happiness",
              label: "Happiness",
              // Happiness charts are green — an explicit, deliberate
              // choice for this specific chart's identity (a single-series
              // chart, not a multi-series categorical assignment the
              // dataviz skill's fixed-slot-order rule governs), not the
              // toolkit default. Same choice made in histogram-chart.tsx
              // for the distribution chart, so every "happiness" chart
              // reads the same color.
              color: categoricalColor(2),
              points,
              band: true,
              markers: (_point, i) => radiusScale(data[i]?.count ?? 0),
              tooltipLabel: (_point, i) => {
                const count = data[i]?.count ?? 0;
                return `${count} day${count === 1 ? "" : "s"}`;
              },
            },
          ]}
          width={width}
          height={height}
          yDomain={[0, 100]}
          valueFormat={(v) => v.toFixed(1)}
          dateFormat="monthYear"
          ariaLabel="Monthly average happiness over time. Use arrow keys to inspect individual months, or hover a point."
        />
      )}
    </ResponsiveChart>
  );
}
