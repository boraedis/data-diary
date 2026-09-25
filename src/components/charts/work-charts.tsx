"use client";

import { useMemo, useState } from "react";
import { CalendarExplorer, type CalendarDay } from "@/components/charts/calendar-explorer";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { Legend } from "@/components/charts/interactive/legend";
import { NO_REFERENCE_LINES, type ReferenceLine } from "@/components/charts/interactive/reference-lines";
import { categoricalColor, categorySequentialInterpolator } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import type { ProfileRegionGroups } from "@/lib/charts";
import {
  COMMUTE_LABELS,
  COMMUTE_ORDER,
  commuteCategories,
  WORK_LOCATION_LABELS,
  WORK_LOCATION_ORDER,
  WORK_MEASURE_LABELS,
  workMeasureValue,
  type CommuteCategory,
  type WorkDay,
  type WorkMeasure,
} from "@/lib/work";
import { WORK_LOCATION_METHODOLOGY, WORK_METHODOLOGY } from "@/lib/viz/methodology";
import { WORK_LOCATION_TRACKING_SPAN, WORK_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// See coffee-charts.tsx for why this thin client layer exists: the
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.
//
// Trend, Daily and Calendar are one page each with a Measure picker, not
// three pages per measure — the same shape Sleep's naps picker and the
// screen-time calendar use. Nine near-identical catalog entries would bury
// the two charts on this list that ask something different.

const MEASURE_OPTIONS: GroupByOption<WorkMeasure>[] = [
  { id: "hours", label: "Hours" },
  { id: "productivity", label: "Productivity" },
  { id: "productiveHours", label: "Productive hours" },
];

/** A fixed slot per measure, shared by the line, scroller and calendar
 * ramp, so switching measures reads as switching to "that measure's
 * colour" on every page. */
const MEASURE_SLOT: Record<WorkMeasure, number> = { hours: 0, productivity: 1, productiveHours: 2 };
const measureColor = (m: WorkMeasure) => categoricalColor(MEASURE_SLOT[m]);

const formatPercent = (v: number) => `${Math.round(v)}%`;
const formatMeasure = (m: WorkMeasure) => (m === "productivity" ? formatPercent : formatDuration);

/** An 8-hour working day, drawn on the Hours measure only — productivity
 * is a percentage, and "8 productive hours" isn't a target anyone sets. */
const WORK_TARGET: readonly ReferenceLine[] = [{ value: 8, label: "8h" }];
const targetFor = (m: WorkMeasure) => (m === "hours" ? WORK_TARGET : NO_REFERENCE_LINES);

function MeasurePicker({ value, onChange }: { value: WorkMeasure; onChange: (m: WorkMeasure) => void }) {
  return <GroupByPicker value={value} onChange={onChange} options={MEASURE_OPTIONS} label="Measure" />;
}

const MEASURE_DESCRIPTIONS: Record<WorkMeasure, string> = {
  hours: "time worked",
  productivity: "self-rated productivity",
  productiveHours: "productive hours (hours worked × productivity)",
};

export function WorkTrendChart({ data }: { data: WorkDay[] }) {
  const [measure, setMeasure] = useState<WorkMeasure>("hours");
  return (
    <TrendExplorer
      data={data}
      title="Work Trend"
      description={`Average ${MEASURE_DESCRIPTIONS[measure]} per logged work day, aggregated by period. Marker size shows how many days fed each point; the band shows ±1 standard deviation around it.`}
      methodology={WORK_METHODOLOGY}
      trackingSpan={WORK_TRACKING_SPAN}
      // The measure is the series' identity: TrendExplorer recomputes when
      // `seriesId`/`label` change, which is what makes switching measures
      // redraw rather than keep the previous measure's points.
      seriesId={measure}
      label={WORK_MEASURE_LABELS[measure]}
      color={measureColor(measure)}
      getValue={(d) => workMeasureValue(d, measure)}
      aggregate="mean"
      valueFormat={formatMeasure(measure)}
      tooltipLabel={(items) => `${items.length} work day${items.length === 1 ? "" : "s"}`}
      referenceLines={targetFor(measure)}
      extraFilters={<MeasurePicker value={measure} onChange={setMeasure} />}
      ariaLabel={`Average ${MEASURE_DESCRIPTIONS[measure]} per work day over time. Use arrow keys to inspect individual buckets, or hover a point.`}
    />
  );
}

// Occupation and residence only — the two that change what a working day
// looks like. Same opt-in picker as Daily Distance Walked.
type RegionType = "none" | "occupation" | "residence";

const REGION_TYPE_OPTIONS: GroupByOption<RegionType>[] = [
  { id: "none", label: "None" },
  { id: "occupation", label: "Occupation" },
  { id: "residence", label: "Residence" },
];

export function WorkDailyChart({ data, regionGroups }: { data: WorkDay[]; regionGroups: ProfileRegionGroups }) {
  const [measure, setMeasure] = useState<WorkMeasure>("hours");
  const [regionType, setRegionType] = useState<RegionType>("none");

  const series = useMemo(
    () => [
      {
        id: measure,
        label: WORK_MEASURE_LABELS[measure],
        color: measureColor(measure),
        data: data.flatMap((d) => {
          const value = workMeasureValue(d, measure);
          return value === undefined ? [] : [{ date: d.date, value }];
        }),
      },
    ],
    [data, measure],
  );
  const regions = useMemo(() => (regionType === "none" ? [] : regionGroups[regionType]), [regionType, regionGroups]);

  return (
    <DailyExplorer
      series={series}
      title="Daily Work"
      description={`A day-by-day look at ${MEASURE_DESCRIPTIONS[measure]}. Scroll or drag to zoom, and use the strip below to move through the range.`}
      methodology={WORK_METHODOLOGY}
      trackingSpan={WORK_TRACKING_SPAN}
      valueFormat={formatMeasure(measure)}
      regions={regions}
      referenceLines={targetFor(measure)}
      // A week rather than the usual 30 days: only work days log hours, so
      // seven points is roughly a working week and a half — the rhythm
      // this chart is for. The picker still offers the longer windows.
      initialWindow={7}
      extraFilters={
        <>
          <MeasurePicker value={measure} onChange={setMeasure} />
          <GroupByPicker value={regionType} onChange={setRegionType} options={REGION_TYPE_OPTIONS} label="Regions" />
        </>
      }
      ariaLabel={`Daily ${MEASURE_DESCRIPTIONS[measure]}. Scroll or pinch to zoom, drag to pan, hover a day for its exact value.`}
    />
  );
}

export function WorkCalendarChart({ data }: { data: WorkDay[] }) {
  const [measure, setMeasure] = useState<WorkMeasure>("hours");

  const points = useMemo<CalendarDay[]>(
    () =>
      data.flatMap((d) => {
        const value = workMeasureValue(d, measure);
        return value === undefined ? [] : [{ date: d.date, value }];
      }),
    [data, measure],
  );
  // One ramp per measure, in that measure's own slot — the screen-time
  // calendar's pattern (see `DeviceCalendarChart`).
  const colorInterpolator = useMemo(() => categorySequentialInterpolator(MEASURE_SLOT[measure], "dark"), [measure]);

  return (
    <CalendarExplorer
      data={points}
      title="Work Calendar"
      description={`A year-by-year heatmap of ${MEASURE_DESCRIPTIONS[measure]}. Days with nothing logged are left blank.`}
      methodology={WORK_METHODOLOGY}
      trackingSpan={WORK_TRACKING_SPAN}
      formatValue={formatMeasure(measure)}
      valueLabel={WORK_MEASURE_LABELS[measure].toLowerCase()}
      colorInterpolator={colorInterpolator}
      extraFilters={<MeasurePicker value={measure} onChange={setMeasure} />}
      ariaLabel={`Calendar heatmap of daily ${MEASURE_DESCRIPTIONS[measure]}.`}
    />
  );
}

type PlaceMode = "location" | "commute";

const PLACE_MODE_OPTIONS: GroupByOption<PlaceMode>[] = [
  { id: "location", label: "Work location" },
  { id: "commute", label: "Commute" },
];

const locationColor = (l: (typeof WORK_LOCATION_ORDER)[number]) => categoricalColor(WORK_LOCATION_ORDER.indexOf(l));
const commuteColor = (c: CommuteCategory) => categoricalColor(COMMUTE_ORDER.indexOf(c));

/**
 * Where each working day happened, or how you got there — a categorical
 * calendar on the same one-colour-per-category mechanism as Day Types,
 * except a day can carry several (a morning at home, an afternoon in the
 * office), which the primitive paints as a blend of their colours.
 *
 * Days with nothing recorded are left blank rather than drawn as an
 * "unknown" colour; see `WorkDay`'s comment on why an empty array can only
 * mean "not recorded".
 */
export function WorkLocationCalendarChart({ data }: { data: WorkDay[] }) {
  const [mode, setMode] = useState<PlaceMode>("location");

  const { points, present } = useMemo(() => {
    const seen = new Set<string>();
    const out: CalendarDay[] = [];
    for (const day of data) {
      const categories =
        mode === "location"
          ? day.locations.map((l) => ({ id: l as string, label: WORK_LOCATION_LABELS[l], color: locationColor(l) }))
          : commuteCategories(day).map((c) => ({ id: c as string, label: COMMUTE_LABELS[c], color: commuteColor(c) }));
      if (categories.length === 0) continue;
      for (const c of categories) seen.add(c.id);
      out.push({
        date: day.date,
        // A constant, as on Day Types: there's no magnitude to encode, and
        // a varying value would make one location look "stronger" than
        // another for no reason a reader could interpret.
        value: 1,
        categories: categories.map(({ label, color }) => ({ label, color })),
      });
    }
    return { points: out, present: seen };
  }, [data, mode]);

  const legendSeries =
    mode === "location"
      ? WORK_LOCATION_ORDER.filter((l) => present.has(l)).map((l) => ({
          id: l,
          label: WORK_LOCATION_LABELS[l],
          color: locationColor(l),
        }))
      : COMMUTE_ORDER.filter((c) => present.has(c)).map((c) => ({ id: c, label: COMMUTE_LABELS[c], color: commuteColor(c) }));

  return (
    <CalendarExplorer
      data={points}
      title="Work Location Calendar"
      description={
        mode === "location"
          ? "Where each working day happened. A day split between places shows a mix of their colours."
          : "How you got to work each day. Days worked with no commute logged count as no commute."
      }
      methodology={WORK_LOCATION_METHODOLOGY}
      trackingSpan={WORK_LOCATION_TRACKING_SPAN}
      formatValue={() => ""}
      valueLabel=""
      extraFilters={<GroupByPicker value={mode} onChange={setMode} options={PLACE_MODE_OPTIONS} label="Colour by" />}
      legend={<Legend series={legendSeries} />}
      ariaLabel={
        mode === "location"
          ? "Calendar of where each working day happened — home, office, cafe and so on."
          : "Calendar of how you commuted each working day."
      }
    />
  );
}
