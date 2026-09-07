"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import {
  InteractiveArea,
  type InteractiveAreaCategory,
  type InteractiveAreaMode,
  type InteractiveAreaPoint,
} from "@/components/charts/interactive/interactive-area";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate } from "@/lib/date";
import { formatDuration } from "@/lib/viz/format";
import type { SleepNight } from "@/lib/charts";

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
      title="Sleep trend"
      description="Average time asleep per night. Marker size shows how many nights fed each point; the band shows that bucket's range."
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
      title="Nightly sleep"
      description="Every logged night. Scroll or drag to zoom, and use the strip below to move through the range."
      seriesId="sleep"
      label="Sleep"
      color={SLEEP_COLOR}
      valueFormat={formatHours}
      ariaLabel="Time asleep each night. Scroll or pinch to zoom, drag to pan, hover a night for its exact duration."
    />
  );
}

/** Locations get a fixed slot by overall frequency, and the tail folds into
 * "Other".
 *
 * There are seven location types but the categorical palette has five real
 * slots before it flattens to one muted grey, so something has to give. The
 * tail here is genuinely small — `Family's`, `Transport` and `Outdoors` are
 * 42 nights between them against 844 at home — so folding them loses very
 * little, where letting them fall off the palette would silently make three
 * categories indistinguishable. */
const MAX_LOCATIONS = 4;
const OTHER = "__other__";

type LocationMetric = "nights" | "hours";

const METRIC_OPTIONS: GroupByOption<LocationMetric>[] = [
  { id: "nights", label: "Nights" },
  { id: "hours", label: "Hours" },
];

const MODE_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "proportional", label: "Share" },
  { id: "stacked", label: "Count" },
];

/**
 * Where you slept, over time — as a share of nights (or of hours slept).
 *
 * **Nights with no location recorded are excluded, not drawn as a
 * category.** That isn't hiding a gap: sleep location simply wasn't tracked
 * before mid-2023 (zero recorded nights in 2019-2022, 144 of 363 in 2023,
 * then effectively all of them). Including those nights would fill four
 * years of the chart with a single "unknown" band that says nothing about
 * where anyone slept — the same reasoning the recap's coverage rule uses,
 * where an untracked period reads as untracked rather than as a value.
 *
 * The effect is that the chart begins when the data does. That's the honest
 * shape, and the empty state covers the case where nothing is recorded at
 * all.
 */
export function SleepLocationChart({ data }: { data: SleepNight[] }) {
  const [metric, setMetric] = useState<LocationMetric>("nights");
  const [mode, setMode] = useState<InteractiveAreaMode>("proportional");
  const [period, setPeriod] = useState<Period>("month");

  const recorded = useMemo(() => data.filter((n) => n.locationType !== null), [data]);

  // Slots assigned once from overall totals, so a category keeps its colour
  // regardless of which buckets happen to contain it.
  const categories = useMemo<InteractiveAreaCategory[]>(() => {
    const totals = new Map<string, number>();
    for (const night of recorded) {
      const key = night.locationType as string;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const kept = ranked.slice(0, MAX_LOCATIONS).map((id) => ({ id, label: id }));
    return ranked.length > MAX_LOCATIONS ? [...kept, { id: OTHER, label: "Other" }] : kept;
  }, [recorded]);

  const points = useMemo<InteractiveAreaPoint[]>(() => {
    const kept = new Set(categories.map((c) => c.id));
    return groupByPeriod(recorded, period, (n) => n.date).map(({ start, items }) => {
      const values: Record<string, number> = {};
      for (const night of items) {
        const raw = night.locationType as string;
        const id = kept.has(raw) ? raw : OTHER;
        values[id] = (values[id] ?? 0) + (metric === "nights" ? 1 : asHours(night.durationMinutes));
      }
      return { x: parseDate(start), values };
    });
  }, [recorded, categories, period, metric]);

  return (
    <ChartPage
      title="Sleep locations"
      filters={
        <>
          <GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="Show" />
          <GroupByPicker value={metric} onChange={setMetric} options={METRIC_OPTIONS} label="Measure" />
          <PeriodPicker value={period} onChange={setPeriod} />
        </>
      }
    >
      <ChartCard
        title="Sleep locations"
        description="Where you slept, as a share of nights. Only nights with a location recorded — that wasn't tracked before mid-2023."
        empty={points.length === 0}
      >
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]">
          {({ width, height }) => (
            <InteractiveArea
              categories={categories}
              points={points}
              width={width}
              height={height}
              mode={mode}
              valueFormat={(v) =>
                metric === "nights" ? `${Math.round(v)} night${v === 1 ? "" : "s"}` : formatHours(v)
              }
              dateFormat="monthYear"
              ariaLabel="Where you slept over time, as a share of nights with a location recorded."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
