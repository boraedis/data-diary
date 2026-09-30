"use client";

import { useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveLine, type InteractiveLinePoint } from "@/components/charts/interactive/interactive-line";
import { HEIGHT_CLASS, bucketFor } from "@/components/recap/recap-health-charts";
import { parseDate } from "@/lib/date";
import { groupByPeriod } from "@/lib/viz/bin";
import type { DatedValue } from "@/lib/recap-body";

// The recap's weight trend (#529): the same primitive and colour token as
// /charts/weight, minus the scroller and field picker — a recap is a fixed
// window. Weekly/monthly averages rather than raw weigh-ins, the same
// bucketing the happiness trend uses.
export function RecapWeightTrend({ series, periodLabel }: { series: DatedValue[]; periodLabel: string }) {
  const bucket = bucketFor(series.map((d) => d.date));
  const lineSeries = useMemo(() => {
    const points: InteractiveLinePoint[] = groupByPeriod(series, bucket, (d) => d.date).map(
      ({ start, items }) => ({
        x: parseDate(start),
        y: items.reduce((total, d) => total + d.value, 0) / items.length,
      })
    );
    return [{ id: "weight", label: "Weight", color: "var(--metric-weight)", points, markers: true }];
  }, [series, bucket]);

  return (
    <ResponsiveChart className={HEIGHT_CLASS}>
      {({ width, height }) => (
        <InteractiveLine
          series={lineSeries}
          width={width}
          height={height}
          zoom="none"
          dateFormat={bucket === "week" ? "short" : "monthYear"}
          valueFormat={(v) => `${v.toFixed(1)} kg`}
          ariaLabel={`Average weight by ${bucket} across ${periodLabel}. Use arrow keys to inspect individual points, or hover.`}
        />
      )}
    </ResponsiveChart>
  );
}
