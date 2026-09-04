"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveScroller, type InteractiveScrollerPoint, type InteractiveScrollerSeries } from "@/components/charts/interactive/interactive-scroller";
import { MultiSelectPicker, type MultiSelectOption } from "@/components/charts/interactive/multi-select-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate } from "@/lib/date";
import type { ProfileRegionGroups, WeightMetricsPoint } from "@/lib/charts";

// First real consumer of InteractiveScroller (#117) — weight is exactly
// this primitive's use case (raw daily density, not a pre-bucketed
// series), unlike InteractiveLine's grouped/aggregated shape this chart
// used before. Direct zoom (scroll or drag on the plot itself) + a synced
// minimap with its own brush replace the old brush-only overview strip.
//
// #117 follow-up added the filters row: multi-select which of Weight/Body
// fat/Muscle mass are plotted (all sharing one y-scale — a deliberate call,
// see convertMass' own comment on "% of Weight" for how that stays
// readable across genuinely different units), a Kg/Lbs/% of Weight unit
// toggle, and (private page only) Age/Occupation/Residence/Relationship
// region overlays backed by the real profile timelines in
// src/lib/profile.ts.

type WeightField = "weight" | "bodyFat" | "muscleMass";
type WeightUnit = "kg" | "lbs" | "pctWeight";
type RegionType = "age" | "occupation" | "residence" | "relationship";

const FIELD_OPTIONS: MultiSelectOption<WeightField>[] = [
  { id: "weight", label: "Weight" },
  { id: "bodyFat", label: "Body fat %" },
  { id: "muscleMass", label: "Muscle mass" },
];

// Fixed slot per field, NOT array position — a series' color must survive
// its siblings being toggled off (Legend's own "surviving after a filter"
// rule; see legend.tsx). Weight always gets its own dedicated
// --metric-weight token (violet, per explicit request) rather than a
// categorical slot at all — see globals.css for why that needed a new
// token instead of reusing chart-1..5.
const FIELD_SLOT: Record<Exclude<WeightField, "weight">, number> = { bodyFat: 0, muscleMass: 1 };
function fieldColor(field: WeightField): string {
  return field === "weight" ? "var(--metric-weight)" : categoricalColor(FIELD_SLOT[field]);
}

const UNIT_OPTIONS: GroupByOption<WeightUnit>[] = [
  { id: "kg", label: "Kg" },
  { id: "lbs", label: "Lbs" },
  { id: "pctWeight", label: "% of Weight" },
];

const REGION_TYPE_OPTIONS: MultiSelectOption<RegionType>[] = [
  { id: "age", label: "Age" },
  { id: "occupation", label: "Occupation" },
  { id: "residence", label: "Residence" },
  { id: "relationship", label: "Relationship" },
];

const KG_TO_LB = 2.20462;

/** Converts a kg-native mass value (weight or muscle mass) per the
 * selected unit. "% of Weight" divides by THAT SAME DAY's own weight, not
 * a fixed baseline — so a point whose day has no weight logged can't
 * convert and is dropped (returns null) rather than plotted against a
 * stale or averaged weight. Weight itself under "% of Weight" is
 * therefore trivially 100% every day: not a bug, a deliberate reference
 * line the other two series' percentages can be read against, since all
 * three then share one coherent 0-100(ish) percent y-scale instead of kg
 * and % fighting for the same axis at wildly different magnitudes. Body
 * fat is unaffected by this toggle entirely — it's already a percentage,
 * with nothing to convert. */
function convertMass(valueKg: number, unit: WeightUnit, weightKgThatDay: number | null): number | null {
  if (unit === "kg") return valueKg;
  if (unit === "lbs") return valueKg * KG_TO_LB;
  if (!weightKgThatDay) return null;
  return (valueKg / weightKgThatDay) * 100;
}

function buildSeries(data: WeightMetricsPoint[], fields: WeightField[], unit: WeightUnit): InteractiveScrollerSeries[] {
  const series: InteractiveScrollerSeries[] = [];

  if (fields.includes("weight")) {
    const points: InteractiveScrollerPoint[] = [];
    for (const d of data) {
      if (d.weightKg === null) continue;
      const y = convertMass(d.weightKg, unit, d.weightKg);
      if (y !== null) points.push({ x: parseDate(d.date), y });
    }
    series.push({ id: "weight", label: "Weight", color: fieldColor("weight"), movingAverage: true, points });
  }
  if (fields.includes("bodyFat")) {
    const points: InteractiveScrollerPoint[] = data
      .filter((d) => d.bodyFatPercent !== null)
      .map((d) => ({ x: parseDate(d.date), y: d.bodyFatPercent as number }));
    series.push({ id: "bodyFat", label: "Body fat %", color: fieldColor("bodyFat"), movingAverage: true, points });
  }
  if (fields.includes("muscleMass")) {
    const points: InteractiveScrollerPoint[] = [];
    for (const d of data) {
      if (d.muscleMassKg === null) continue;
      const y = convertMass(d.muscleMassKg, unit, d.weightKg);
      if (y !== null) points.push({ x: parseDate(d.date), y });
    }
    series.push({ id: "muscleMass", label: "Muscle mass", color: fieldColor("muscleMass"), movingAverage: true, points });
  }
  return series;
}

export function WeightScrollerChart({
  data,
  regionGroups,
  backHref,
  backLabel,
}: {
  data: WeightMetricsPoint[];
  /** Age/occupation/residence/relationship region datasets — private-only
   * (see getProfileRegionGroups' own comment in src/lib/charts.ts). Omit
   * entirely on the public chart page rather than passing empty arrays, so
   * the region-type picker doesn't render there at all. */
  regionGroups?: ProfileRegionGroups;
  backHref?: string;
  backLabel?: string;
}) {
  const [fields, setFields] = useState<WeightField[]>(["weight"]);
  const [unit, setUnit] = useState<WeightUnit>("kg");
  // Starts empty — up to four depth-stacked overlapping bands at once is a
  // lot to greet a first-time visitor with; showing them is an opt-in, not
  // a default.
  const [regionTypes, setRegionTypes] = useState<RegionType[]>([]);

  const series = useMemo(() => buildSeries(data, fields, unit), [data, fields, unit]);
  const regions = useMemo(() => regionTypes.flatMap((t) => regionGroups?.[t] ?? []), [regionTypes, regionGroups]);

  const unitSuffix = unit === "pctWeight" ? "%" : unit === "lbs" ? "lbs" : "kg";

  return (
    <ChartPage
      title="Weight over time"
      backHref={backHref}
      backLabel={backLabel}
      filters={
        <>
          <MultiSelectPicker values={fields} onChange={setFields} options={FIELD_OPTIONS} label="Show" minSelected={1} />
          <GroupByPicker value={unit} onChange={setUnit} options={UNIT_OPTIONS} label="Unit" />
          {regionGroups ? (
            <MultiSelectPicker values={regionTypes} onChange={setRegionTypes} options={REGION_TYPE_OPTIONS} label="Regions" />
          ) : null}
        </>
      }
    >
      <ChartCard
        title="Weight over time"
        description="Scroll or drag on the chart to zoom, or drag the strip below it; double-click to reset."
        empty={series.every((s) => s.points.length === 0)}
      >
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
          {({ width, height }) => (
            <InteractiveScroller
              series={series}
              width={width}
              height={height}
              regions={regions}
              valueFormat={(v) => `${v.toFixed(1)} ${unitSuffix}`}
              yTickFormat={(d) => `${d} ${unitSuffix}`}
              ariaLabel="Body weight metrics over time. Use arrow keys to inspect individual entries, or hover a point."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
