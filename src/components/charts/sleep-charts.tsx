"use client";

import { useMemo, useState } from "react";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import {
  CompositionExplorer,
  rankCategories,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import type { ReferenceLine } from "@/components/charts/interactive/reference-lines";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import type { SleepNight } from "@/lib/charts";
import { SLEEP_LOCATION_METHODOLOGY, SLEEP_METHODOLOGY } from "@/lib/viz/methodology";
import { SLEEP_LOCATION_TRACKING_SPAN, SLEEP_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// See coffee-charts.tsx for why this thin client layer exists: the
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

const SLEEP_COLOR = categoricalColor(4);
// Only used as the second line in "Both" mode (see SLEEP_METRIC_OPTIONS
// below) — a distinct slot from SLEEP_COLOR so the two lines read as
// separate series, not a color reused across itself.
const NAP_COLOR = categoricalColor(1);
const asHours = (minutes: number) => minutes / 60;
const formatHours = (hours: number) => formatDuration(hours);

/** The commonly-cited adult 8 hours, as a dotted target on both the trend
 * and nightly charts (#444) — the first reuse of the reference-line prop
 * outside the Work charts it was built for. Module-level so its identity
 * is stable (it's a `useD3` dependency inside the primitives). */
const SLEEP_TARGET: readonly ReferenceLine[] = [{ value: 8, label: "8h" }];

/** Whether to plot sleep alone, sleep with naps folded in, or both lines at
 * once. Shared between Sleep Trend and Sleep Daily so the picker (and its
 * behavior) reads the same on both pages. */
type SleepMetric = "sleep" | "sleepPlusNaps" | "both";

const SLEEP_METRIC_OPTIONS: GroupByOption<SleepMetric>[] = [
  { id: "sleep", label: "Sleep" },
  { id: "sleepPlusNaps", label: "Sleep + Naps" },
  { id: "both", label: "Both" },
];

/** Picks the metric state down to what the data can actually support — the
 * "Sleep + Naps"/"Both" options are pointless (and misleading, implying a
 * distinction that doesn't exist) on a history with no naps recorded. */
function useSleepMetric(data: SleepNight[]) {
  const hasNaps = useMemo(() => data.some((n) => (n.napMinutes ?? 0) > 0), [data]);
  const [metric, setMetric] = useState<SleepMetric>("sleep");
  return { hasNaps, metric: hasNaps ? metric : "sleep", setMetric } as const;
}

const sleepHours = (night: SleepNight) => asHours(night.durationMinutes);
const sleepPlusNapsHours = (night: SleepNight) => asHours(night.durationMinutes + (night.napMinutes ?? 0));

export function SleepTrendChart({ data }: { data: SleepNight[] }) {
  const { hasNaps, metric, setMetric } = useSleepMetric(data);

  return (
    <TrendExplorer
      data={data}
      title="Sleep Trend"
      description="Trend in sleep duration over time, aggregated by period. Marker size shows how many nights fed each point; the band shows ±1 standard deviation around it."
      methodology={SLEEP_METHODOLOGY}
      trackingSpan={SLEEP_TRACKING_SPAN}
      seriesId="sleep"
      label={metric === "sleepPlusNaps" ? "Sleep + Naps" : "Sleep"}
      color={SLEEP_COLOR}
      getValue={metric === "sleepPlusNaps" ? sleepPlusNapsHours : sleepHours}
      extraSeries={
        metric === "both"
          ? [{ id: "sleepPlusNaps", label: "Sleep + Naps", color: NAP_COLOR, getValue: sleepPlusNapsHours }]
          : undefined
      }
      aggregate="mean"
      valueFormat={formatHours}
      tooltipLabel={(nights) => `${nights.length} night${nights.length === 1 ? "" : "s"}`}
      referenceLines={SLEEP_TARGET}
      extraFilters={
        hasNaps ? (
          <GroupByPicker value={metric} onChange={setMetric} options={SLEEP_METRIC_OPTIONS} label="Measure" />
        ) : undefined
      }
      ariaLabel="Average time asleep per night over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}

export function SleepDailyChart({ data }: { data: SleepNight[] }) {
  const { hasNaps, metric, setMetric } = useSleepMetric(data);

  const series = useMemo(() => {
    const sleepSeries = { id: "sleep", label: "Sleep", color: SLEEP_COLOR, data: data.map((n) => ({ date: n.date, value: sleepHours(n) })) };
    const sleepPlusNapsSeries = {
      id: "sleepPlusNaps",
      label: "Sleep + Naps",
      color: metric === "both" ? NAP_COLOR : SLEEP_COLOR,
      data: data.map((n) => ({ date: n.date, value: sleepPlusNapsHours(n) })),
    };
    if (metric === "sleep") return [sleepSeries];
    if (metric === "sleepPlusNaps") return [sleepPlusNapsSeries];
    return [sleepSeries, sleepPlusNapsSeries];
  }, [data, metric]);

  return (
    <DailyExplorer
      series={series}
      title="Nightly Sleep"
      description="A night-by-night look at sleep duration. Scroll or drag to zoom, and use the strip below to move through the range."
      methodology={SLEEP_METHODOLOGY}
      trackingSpan={SLEEP_TRACKING_SPAN}
      valueFormat={formatHours}
      referenceLines={SLEEP_TARGET}
      extraFilters={
        hasNaps ? (
          <GroupByPicker value={metric} onChange={setMetric} options={SLEEP_METRIC_OPTIONS} label="Measure" />
        ) : undefined
      }
      ariaLabel="Time asleep each night. Scroll or pinch to zoom, drag to pan, hover a night for its exact duration."
    />
  );
}


type LocationMetric = "nights" | "hours";

const METRIC_OPTIONS: GroupByOption<LocationMetric>[] = [
  { id: "nights", label: "Nights" },
  { id: "hours", label: "Hours" },
];

/**
 * Where you slept, over time — as a share of nights (or of hours slept).
 *
 * **Nights with no location recorded are excluded, not drawn as a
 * category.** That isn't hiding a gap: sleep location wasn't tracked before
 * mid-2023 (zero recorded nights in 2019-2022, 144 of 363 in 2023, then
 * effectively all of them). Including them would fill four years of the
 * chart with a single "unknown" band that says nothing about where anyone
 * slept — the same reasoning the recap's coverage rule uses, where an
 * untracked period reads as untracked rather than as a value. The chart
 * begins where the data does.
 */
export function SleepLocationChart({ data }: { data: SleepNight[] }) {
  const [metric, setMetric] = useState<LocationMetric>("nights");

  const recorded = useMemo(() => data.filter((n) => n.locationType !== null), [data]);

  // All seven location types are their own bands (#456), not four plus
  // "Other". There's no established colour for location types, so the
  // five biggest take the palette slots and the two smallest the pale
  // tail colour; they're 42 nights between them against 844 at home, so
  // they're thin, but each is still named in its label or on hover.
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const night of recorded) {
      const key = night.locationType as string;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    return rankCategories(totals);
  }, [recorded]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      recorded.map((night) => {
        return {
          date: night.date,
          values: { [night.locationType as string]: metric === "nights" ? 1 : asHours(night.durationMinutes) },
        };
      }),
    [recorded, metric],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={categories}
      title="Sleep Locations"
      description="Where you slept, as a share of nights. Only nights with a location recorded — that wasn't tracked before mid-2023."
      methodology={SLEEP_LOCATION_METHODOLOGY}
      trackingSpan={SLEEP_LOCATION_TRACKING_SPAN}
      valueFormat={(v) =>
        metric === "nights" ? `${Math.round(v)} night${v === 1 ? "" : "s"}` : formatHours(v)
      }
      extraFilters={
        <GroupByPicker value={metric} onChange={setMetric} options={METRIC_OPTIONS} label="Measure" />
      }
      ariaLabel="Where you slept over time, as a share of nights with a location recorded."
    />
  );
}
