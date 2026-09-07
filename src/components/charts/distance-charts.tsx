"use client";

import { DailyValueScroller } from "@/components/charts/daily-value-scroller";
import { MonthlyAverageChart } from "@/components/charts/monthly-average-chart";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue, MonthlyAverage } from "@/lib/charts";

// See coffee-charts.tsx for why this thin client layer exists: the generic
// chart components take formatter functions, which a server-component page
// cannot pass across the boundary.

const DISTANCE_COLOR = categoricalColor(3);
const formatKm = (v: number) => `${v.toFixed(1)} km`;

export function DistanceTrendChart({ data }: { data: MonthlyAverage[] }) {
  return (
    <MonthlyAverageChart
      data={data}
      seriesId="distance"
      label="Distance walked"
      color={DISTANCE_COLOR}
      valueFormat={formatKm}
      ariaLabel="Monthly average distance walked per day. Use arrow keys to inspect individual months, or hover a point."
    />
  );
}

export function DistanceDailyChart({ data }: { data: DailyValue[] }) {
  return (
    <DailyValueScroller
      data={data}
      seriesId="distance"
      label="Distance walked"
      color={DISTANCE_COLOR}
      valueFormat={formatKm}
      ariaLabel="Daily distance walked. Scroll or pinch to zoom, drag to pan, hover a day for its exact distance."
    />
  );
}
