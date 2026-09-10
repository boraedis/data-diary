"use client";

import { useCallback, useMemo } from "react";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveTimeline } from "@/components/charts/interactive/interactive-timeline";
import { categoricalColor } from "@/lib/viz/color";
import type { LifeTimelineEntry } from "@/lib/charts";

// The first real consumer of InteractiveTimeline (#310) — the primitive
// shipped under #119 deliberately without one, since the candidate datasets
// weren't settled. This is the dataset legacy's TimeLine() actually drew:
// the profile's own occupation/residence/relationship history.
//
// A thin client layer over the primitive, for the usual reason (see
// coffee-charts.tsx): the colour resolver below is a function, which a
// server component can't hand across the boundary.

/**
 * Occupation, residence and relationship history as three stacked lanes.
 *
 * Each entry's own colour, set in the profile admin UI, wins where it's
 * set — the same field `getProfileRegionGroups` already honours for the
 * scroller's background bands, so a job that's blue there is blue here.
 * Entries without one fall back to the primitive's per-lane default rather
 * than to a per-entry rotation: `categoricalColor` has five distinct slots
 * before it flattens to grey, so rotating per entry across a dozen
 * residences would hand most of them the same grey.
 */
export function LifeTimelineChart({ entries }: { entries: LifeTimelineEntry[] }) {
  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) if (entry.color) map.set(entry.id, entry.color);
    return map;
  }, [entries]);

  const color = useCallback(
    (item: { id: string }, laneIndex: number) => colorById.get(item.id) ?? categoricalColor(laneIndex),
    [colorById],
  );

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
      {({ width, height }) => (
        <InteractiveTimeline
          items={entries}
          width={width}
          height={height}
          color={color}
          valueLabel="dates"
          ariaLabel="Life timeline. Occupation, residence and relationship history as three lanes of intervals. Scroll or pinch to zoom the time axis, drag to pan. Hover or focus an entry for its dates and length."
        />
      )}
    </ResponsiveChart>
  );
}
