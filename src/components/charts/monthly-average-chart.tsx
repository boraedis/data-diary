"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { parseDate } from "@/lib/date";
import type { MonthlyAverage } from "@/lib/charts";

/**
 * Legacy's "averager" shape, generically: a monthly mean with a shaded
 * band for that month's real day-to-day range, and marker size carrying
 * how many days fed each point.
 *
 * Generic on purpose. `HappinessAveragerChart` is the same chart written
 * out for one metric, and the chart backlog (#209) holds roughly ten more
 * of exactly this shape — coffee, distance, exercise, technology, sleep.
 * One parameterised wrapper is the difference between those being a page
 * each and a component each. The happiness version stays as it is rather
 * than being retrofitted: it carries chart-specific tooltip copy, and
 * rewriting a shipped chart to prove a point about reuse is not worth the
 * regression risk.
 */
export function MonthlyAverageChart({
  data,
  seriesId,
  label,
  color,
  valueFormat,
  yDomain,
  unitLabel,
  ariaLabel,
}: {
  data: MonthlyAverage[];
  seriesId: string;
  label: string;
  color: string;
  valueFormat: (value: number) => string;
  /** Omit to let the primitive fit the domain to the data. Pass a fixed
   * range only where the scale is genuinely bounded and meaningful. */
  yDomain?: [number, number];
  /** Noun for the tooltip's secondary line, e.g. "days with coffee". */
  unitLabel?: string;
  ariaLabel: string;
}) {
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

  // Marker radius by sample size — a month averaged from 30 days reads as
  // more confident than one averaged from 2. Keyed by index into `data`,
  // which stays in the same order as `points`.
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
              id: seriesId,
              label,
              color,
              points,
              band: true,
              markers: (_point, i) => radiusScale(data[i]?.count ?? 0),
              tooltipLabel: (_point, i) => {
                const count = data[i]?.count ?? 0;
                return `${count} ${unitLabel ?? "day"}${count === 1 ? "" : "s"}`;
              },
            },
          ]}
          width={width}
          height={height}
          yDomain={yDomain}
          valueFormat={valueFormat}
          dateFormat="monthYear"
          ariaLabel={ariaLabel}
        />
      )}
    </ResponsiveChart>
  );
}
