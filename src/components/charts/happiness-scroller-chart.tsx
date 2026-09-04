"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveScroller, type InteractiveScrollerSeries } from "@/components/charts/interactive/interactive-scroller";
import { MultiSelectPicker, type MultiSelectOption } from "@/components/charts/interactive/multi-select-picker";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate } from "@/lib/date";
import type { ProfileRegionGroups } from "@/lib/charts";

// Second real consumer of InteractiveScroller (#117 follow-up) — the raw-
// daily counterpart to happiness-averager-chart.tsx's monthly bucketing,
// same "scroller" role weight's chart plays for its own metric. Much
// simpler than the weight chart: one metric, no unit conversion, so the
// only filter is which region overlays are showing.
//
// No fixed `yDomain` here, deliberately unlike happiness-averager-chart.tsx's
// own `yDomain={[0, 100]}` — InteractiveScroller's default auto-domain
// (min/max of whatever's currently VISIBLE, ±10% padding, recomputed live
// as you zoom/pan) is exactly the "focus in on the relevant range as you
// zoom" behavior wanted here; pinning to the metric's full 0-100 range
// would defeat that by keeping the axis static regardless of zoom level.

type RegionType = "age" | "occupation" | "residence" | "relationship";

const REGION_TYPE_OPTIONS: MultiSelectOption<RegionType>[] = [
  { id: "age", label: "Age" },
  { id: "occupation", label: "Occupation" },
  { id: "residence", label: "Residence" },
  { id: "relationship", label: "Relationship" },
];

export function HappinessScrollerChart({
  data,
  regionGroups,
  backHref,
  backLabel,
}: {
  data: { date: string; happiness: number; reason?: string | null }[];
  /** Age/occupation/residence/relationship region datasets — private-only
   * (see getProfileRegionGroups' own comment in src/lib/charts.ts). Omit
   * entirely on the public chart page so the region-type picker doesn't
   * render there at all. */
  regionGroups?: ProfileRegionGroups;
  backHref?: string;
  backLabel?: string;
}) {
  // Occupation on by default here (unlike the weight chart, which starts
  // with none selected) — explicit request: happiness swings against job
  // changes are exactly the kind of correlation this chart exists to
  // surface at a glance, so it's worth greeting a first-time visitor with
  // rather than making them discover the picker first.
  const [regionTypes, setRegionTypes] = useState<RegionType[]>(regionGroups ? ["occupation"] : []);

  const series = useMemo<InteractiveScrollerSeries[]>(
    () => [
      {
        id: "happiness",
        label: "Happiness",
        // Happiness charts are green wherever they appear in this app
        // (histogram-chart.tsx, happiness-averager-chart.tsx) — an
        // explicit per-metric identity, not the toolkit's default
        // categorical assignment, same reasoning as weight's own
        // --metric-weight.
        color: categoricalColor(2),
        movingAverage: true,
        // `reason` (the day's own happinessReason text) feeds
        // InteractiveScroller's point-label feature directly — shown
        // publicly too, an explicit call by the app owner overriding this
        // app's usual "no per-day free text on the public site" default
        // (see src/lib/public-charts.ts's own comment on this exception).
        points: data.map((d) => ({ x: parseDate(d.date), y: d.happiness, label: d.reason ?? undefined })),
      },
    ],
    [data],
  );

  const regions = useMemo(() => regionTypes.flatMap((t) => regionGroups?.[t] ?? []), [regionTypes, regionGroups]);

  return (
    <ChartPage
      title="Daily happiness"
      backHref={backHref}
      backLabel={backLabel}
      filters={
        regionGroups ? (
          <MultiSelectPicker values={regionTypes} onChange={setRegionTypes} options={REGION_TYPE_OPTIONS} label="Regions" />
        ) : null
      }
    >
      <ChartCard
        title="Daily happiness"
        description="Scroll or drag on the chart to zoom, or drag the strip below it; double-click to reset."
        empty={series[0].points.length === 0}
      >
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
          {({ width, height }) => (
            <InteractiveScroller
              series={series}
              width={width}
              height={height}
              regions={regions}
              valueFormat={(v) => v.toFixed(1)}
              ariaLabel="Daily happiness over time. Use arrow keys to inspect individual entries, or hover a point."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
