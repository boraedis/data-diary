"use client";

import { DailyExplorer } from "@/components/charts/daily-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue } from "@/lib/charts";
import { DISTANCE_METHODOLOGY } from "@/lib/viz/methodology";
import { DISTANCE_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// See coffee-charts.tsx for why this thin client layer exists.

const DISTANCE_COLOR = categoricalColor(3);
const km = (v: number) => `${v.toFixed(1)} km`;

export function DistanceTrendChart({ data }: { data: DailyValue[] }) {
  return (
    <TrendExplorer
      data={data}
      title="Distance Walked Trend"
      description="Trend in distance walked over time, aggregated by period. Marker size shows how many days fed each point; the band shows that bucket's range."
      methodology={DISTANCE_METHODOLOGY}
      trackingSpan={DISTANCE_TRACKING_SPAN}
      seriesId="distance"
      label="Distance walked"
      color={DISTANCE_COLOR}
      getValue={(d) => d.value}
      aggregate="mean"
      valueFormat={km}
      ariaLabel="Average distance walked per day over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}

export function DistanceDailyChart({ data }: { data: DailyValue[] }) {
  return (
    <DailyExplorer
      series={[{ id: "distance", label: "Distance walked", color: DISTANCE_COLOR, data }]}
      title="Daily Distance Walked"
      description="A day-by-day look at distance walked. Scroll or drag to zoom, and use the strip below to move through the range."
      methodology={DISTANCE_METHODOLOGY}
      trackingSpan={DISTANCE_TRACKING_SPAN}
      valueFormat={km}
      ariaLabel="Daily distance walked. Scroll or pinch to zoom, drag to pan, hover a day for its exact distance."
    />
  );
}
