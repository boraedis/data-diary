"use client";

import { useMemo, useState } from "react";
import { DailyExplorer } from "@/components/charts/daily-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import type { SleepNight } from "@/lib/charts";

// See coffee-charts.tsx for why this thin client layer exists: the
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

const SLEEP_COLOR = categoricalColor(4);
const asHours = (minutes: number) => minutes / 60;
const formatHours = (hours: number) => formatDuration(hours);

/** "Everywhere" plus whichever locations the data actually contains. */
const ALL = "__all__";

export function SleepTrendChart({ data }: { data: SleepNight[] }) {
  const [location, setLocation] = useState<string>(ALL);

  // Built from the data rather than the enum so a location that was never
  // used doesn't offer an option that filters to nothing.
  const options = useMemo<GroupByOption<string>[]>(() => {
    const counts = new Map<string, number>();
    for (const night of data) {
      const key = night.locationType ?? "Unrecorded";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
      { id: ALL, label: "Everywhere" },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => ({ id: key, label: key })),
    ];
  }, [data]);

  const scoped = useMemo(
    () =>
      location === ALL
        ? data
        : data.filter((night) => (night.locationType ?? "Unrecorded") === location),
    [data, location],
  );

  return (
    <TrendExplorer
      data={scoped}
      title="Sleep trend"
      description="Average time asleep per night. Marker size shows how many nights fed each point; the band shows that bucket's range."
      seriesId="sleep"
      label="Sleep"
      color={SLEEP_COLOR}
      getValue={(night) => asHours(night.durationMinutes)}
      aggregate="mean"
      valueFormat={formatHours}
      // A filter rather than one line per location, deliberately. There are
      // seven location types and most nights have none recorded at all —
      // eight series against a palette with five real slots before it
      // flattens to grey, where the largest series would be "unrecorded".
      // One location at a time answers "do I sleep worse at a friend's?"
      // without that mess.
      extraFilters={
        <GroupByPicker
          value={location}
          onChange={setLocation}
          options={options}
          label="Slept at"
        />
      }
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
