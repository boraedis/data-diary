"use client";

import { useMemo, useState } from "react";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue, ProfileRegionGroups } from "@/lib/charts";
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
      description="Trend in distance walked over time, aggregated by period. Marker size shows how many days fed each point; the band shows ±1 standard deviation around it."
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

// Age/Occupation/Residence only — no Relationship option here, unlike
// `WeightScrollerChart`'s region picker. Not every `ProfileRegionGroups`
// consumer needs every key; this chart's own ask only named these three.
type RegionType = "none" | "age" | "occupation" | "residence";

const REGION_TYPE_OPTIONS: GroupByOption<RegionType>[] = [
  { id: "none", label: "None" },
  { id: "age", label: "Age" },
  { id: "occupation", label: "Occupation" },
  { id: "residence", label: "Residence" },
];

export function DistanceDailyChart({
  data,
  regionGroups,
}: {
  data: DailyValue[];
  /** Age/occupation/residence region datasets — private-only (see
   * `getProfileRegionGroups`'s own comment in src/lib/charts.ts). Omit
   * entirely on the public chart page rather than passing empty arrays, so
   * the region-type picker doesn't render there at all. */
  regionGroups?: ProfileRegionGroups;
}) {
  // Starts at "none" — showing a region overlay is opt-in, same as
  // WeightScrollerChart's own default.
  const [regionType, setRegionType] = useState<RegionType>("none");
  const regions = useMemo(
    () => (regionType === "none" ? [] : (regionGroups?.[regionType] ?? [])),
    [regionType, regionGroups],
  );

  return (
    <DailyExplorer
      series={[{ id: "distance", label: "Distance walked", color: DISTANCE_COLOR, data }]}
      title="Daily Distance Walked"
      description="A day-by-day look at distance walked. Scroll or drag to zoom, and use the strip below to move through the range."
      methodology={DISTANCE_METHODOLOGY}
      trackingSpan={DISTANCE_TRACKING_SPAN}
      valueFormat={km}
      regions={regions}
      extraFilters={
        regionGroups ? (
          <GroupByPicker value={regionType} onChange={setRegionType} options={REGION_TYPE_OPTIONS} label="Regions" />
        ) : null
      }
      ariaLabel="Daily distance walked. Scroll or pinch to zoom, drag to pan, hover a day for its exact distance."
    />
  );
}
