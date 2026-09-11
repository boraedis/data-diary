"use client";

import { useMemo, useState } from "react";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import {
  CompositionExplorer,
  foldToTopCategories,
  OTHER_ID,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import type { SleepNight } from "@/lib/charts";
import { SLEEP_LOCATION_METHODOLOGY, SLEEP_METHODOLOGY } from "@/lib/viz/methodology";

// See coffee-charts.tsx for why this thin client layer exists: the
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

const SLEEP_COLOR = categoricalColor(4);
const asHours = (minutes: number) => minutes / 60;
const formatHours = (hours: number) => formatDuration(hours);

export function SleepTrendChart({ data }: { data: SleepNight[] }) {
  return (
    <TrendExplorer
      data={data}
      title="Sleep Trend"
      description="Trend in sleep duration over time, aggregated by period. Marker size shows how many nights fed each point; the band shows that bucket's range."
      methodology={SLEEP_METHODOLOGY}
      seriesId="sleep"
      label="Sleep"
      color={SLEEP_COLOR}
      getValue={(night) => asHours(night.durationMinutes)}
      aggregate="mean"
      valueFormat={formatHours}
      tooltipLabel={(nights) => `${nights.length} night${nights.length === 1 ? "" : "s"}`}
      ariaLabel="Average time asleep per night over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}

export function SleepDailyChart({ data }: { data: SleepNight[] }) {
  const points = useMemo(
    () => data.map((night) => ({ date: night.date, value: asHours(night.durationMinutes) })),
    [data],
  );

  return (
    <DailyExplorer
      data={points}
      title="Nightly Sleep"
      description="A night-by-night look at sleep duration. Scroll or drag to zoom, and use the strip below to move through the range."
      methodology={SLEEP_METHODOLOGY}
      seriesId="sleep"
      label="Sleep"
      color={SLEEP_COLOR}
      valueFormat={formatHours}
      ariaLabel="Time asleep each night. Scroll or pinch to zoom, drag to pan, hover a night for its exact duration."
    />
  );
}

/** Four locations plus "Other".
 *
 * There are seven location types but the categorical palette has five real
 * slots before it flattens to one muted grey. The tail is genuinely small —
 * `Family's`, `Transport` and `Outdoors` are 42 nights between them against
 * 844 at home — so folding loses very little, where letting them fall off
 * the palette would silently make three categories indistinguishable. */
const MAX_LOCATIONS = 4;

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

  const { categories, keep } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const night of recorded) {
      const key = night.locationType as string;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    return foldToTopCategories(totals, MAX_LOCATIONS);
  }, [recorded]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      recorded.map((night) => {
        const raw = night.locationType as string;
        const id = keep.has(raw) ? raw : OTHER_ID;
        return {
          date: night.date,
          values: { [id]: metric === "nights" ? 1 : asHours(night.durationMinutes) },
        };
      }),
    [recorded, keep, metric],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={categories}
      title="Sleep Locations"
      description="Where you slept, as a share of nights. Only nights with a location recorded — that wasn't tracked before mid-2023."
      methodology={SLEEP_LOCATION_METHODOLOGY}
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
