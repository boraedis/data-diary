"use client";

import { DailyExplorer } from "@/components/charts/daily-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue } from "@/lib/charts";
import { DISTANCE_METHODOLOGY } from "@/lib/viz/methodology";

// See coffee-charts.tsx for why this thin client layer exists.

const DISTANCE_COLOR = categoricalColor(3);
const km = (v: number) => `${v.toFixed(1)} km`;

export function DistanceTrendChart({ data }: { data: DailyValue[] }) {
  return (
    <TrendExplorer
      data={data}
      title="Distance walked trend"
      description="Average kilometres per day. Marker size shows how many days fed each point; the band shows that bucket's range."
      methodology={DISTANCE_METHODOLOGY}
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
      data={data}
      title="Daily distance walked"
      description="Every logged day. Scroll or drag to zoom, and use the strip below to move through the range."
      methodology={DISTANCE_METHODOLOGY}
      seriesId="distance"
      label="Distance walked"
      color={DISTANCE_COLOR}
      valueFormat={km}
      ariaLabel="Daily distance walked. Scroll or pinch to zoom, drag to pan, hover a day for its exact distance."
    />
  );
}
