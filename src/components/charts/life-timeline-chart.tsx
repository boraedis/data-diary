"use client";

import { useCallback, useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveTimeline } from "@/components/charts/interactive/interactive-timeline";
import { GroupByPicker } from "@/components/charts/interactive/group-by-picker";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { categoricalColor } from "@/lib/viz/color";
import { parseDate, todayDateString } from "@/lib/date";
import {
  buildTimelineView,
  GROUP_BY_OPTIONS,
  type LifeTimelineEntry,
  type LifeTimelineGroupBy,
  type LifeTimelineMode,
} from "@/lib/life-timeline";
import { TIMELINE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

// The first real consumer of InteractiveTimeline (#310) — the profile's
// occupation/residence/relationship history, the dataset legacy's
// TimeLine() actually drew. Owns its own page shell rather than letting
// page.tsx do it, the same way composition-explorer and the weight chart
// do: the filters and the chart share state, and only plain data can cross
// the server/client boundary.

const MODE_OPTIONS: { id: LifeTimelineMode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "occupation", label: "Work" },
  { id: "residence", label: "Homes" },
];

/**
 * The year the chart opens on.
 *
 * The record reaches back to 2004, but the great majority of it — every
 * job after school, every address since the first dorm — is 2016 onward,
 * so opening on the full extent spends half the width on a single
 * childhood address bar. The earlier years are still there: zoom out, drag
 * the range slider to its left edge, or hit Reset.
 */
const DEFAULT_START = "2016-01-01";

/** Each mode remembers its own grouping, so switching Work → Homes → Work
 * doesn't silently reset a grouping you'd chosen. Keyed by mode rather
 * than one shared value because the two modes' groupings aren't the same
 * set — "Company" means nothing to a residence. */
type GroupByByMode = Record<LifeTimelineMode, LifeTimelineGroupBy>;

const INITIAL_GROUP_BY: GroupByByMode = { all: "entry", occupation: "entry", residence: "entry" };

export function LifeTimelineChart({ entries }: { entries: LifeTimelineEntry[] }) {
  const [mode, setMode] = useState<LifeTimelineMode>("all");
  const [groupByMode, setGroupByMode] = useState<GroupByByMode>(INITIAL_GROUP_BY);
  const groupBy = groupByMode[mode];

  const items = useMemo(() => buildTimelineView(entries, { mode, groupBy }), [entries, mode, groupBy]);

  // The full extent of everything, which is what the range slider's track
  // has to span — not the current view, and not the entries in the current
  // mode, or the slider's own bounds would move under the user every time
  // they switched mode.
  const fullExtent = useMemo<[Date, Date] | null>(() => {
    let min: string | null = null;
    let max: string | null = null;
    const today = todayDateString();
    for (const entry of entries) {
      if (min === null || entry.start < min) min = entry.start;
      const end = entry.end ?? today;
      if (max === null || end > max) max = end;
    }
    return min && max ? [parseDate(min), parseDate(max)] : null;
  }, [entries]);

  const defaultDomain = useMemo<[Date, Date] | null>(() => {
    if (!fullExtent) return null;
    const start = parseDate(DEFAULT_START);
    // If the record starts after the default (or ends before it), the
    // default window is meaningless — show everything rather than an empty
    // or inverted range.
    if (start <= fullExtent[0] || start >= fullExtent[1]) return null;
    return [start, fullExtent[1]];
  }, [fullExtent]);

  // `undefined` means "not touched yet, use the default"; an explicit
  // `null` means the user has genuinely zoomed all the way back out. The
  // two have to be distinguishable, or resetting to the full extent would
  // snap straight back to 2016.
  const [domain, setDomain] = useState<[Date, Date] | null | undefined>(undefined);
  const effectiveDomain = domain === undefined ? defaultDomain : domain;

  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.color) continue;
      map.set(entry.id, entry.color);
      // Roles are their own bars in the role view, with their own ids, so
      // they need their own entries here — otherwise every promotion falls
      // through to the lane default and a job's progression renders in a
      // colour unrelated to the job. Inheriting the parent's colour is what
      // makes the role view read as "this job, over time".
      for (const role of entry.roles) map.set(role.id, entry.color);
    }
    return map;
  }, [entries]);

  /**
   * Each entry's own colour, set in the profile admin UI, wins where it's
   * set — the same field `getProfileRegionGroups` honours for the
   * scroller's background bands, so a job that's blue there is blue here.
   * Otherwise the primitive's per-lane default: `categoricalColor` has five
   * distinct slots before it flattens to grey, so rotating per entry across
   * a dozen residences would hand most of them the same grey.
   *
   * Roles inherit their job's colour (see the map above), so a job's
   * progression reads as one thing in the role view.
   */
  const color = useCallback(
    (item: { id: string }, laneIndex: number) => colorById.get(item.id) ?? categoricalColor(laneIndex),
    [colorById],
  );

  const groupByOptions = GROUP_BY_OPTIONS[mode];

  return (
    <ChartPage
      title="Life timeline"
      description="Occupation, residence and relationship history. Overlapping entries stack within their lane; an entry with no end date is still running."
      info={{ interactionGuide: TIMELINE_INTERACTION_GUIDE }}
      filters={
        <>
          <GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="Timeline" />
          {groupByOptions.length > 0 ? (
            <GroupByPicker
              value={groupBy}
              onChange={(id) => setGroupByMode((cur) => ({ ...cur, [mode]: id }))}
              options={groupByOptions}
              label="Group by"
            />
          ) : null}
          {fullExtent ? (
            <TimeRangePicker
              domain={fullExtent}
              value={effectiveDomain}
              onChange={(range) => setDomain(range)}
              label="Period"
            />
          ) : null}
        </>
      }
    >
      <ChartCard empty={entries.length === 0}>
        <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
          {({ width, height }) => (
            <InteractiveTimeline
              items={items}
              width={width}
              height={height}
              color={color}
              domain={effectiveDomain}
              onDomainChange={setDomain}
              valueLabel="dates"
              ariaLabel="Life timeline. Intervals grouped into lanes down the left. Scroll or pinch to zoom the time axis, drag to pan. Hover or focus an entry for its dates and length."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
