"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { InteractiveTreemap } from "@/components/charts/interactive/interactive-treemap";
import { Legend, type LegendSeries } from "@/components/charts/interactive/legend";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import type { PeopleDay } from "@/lib/charts";
import { parseDate, toDateString } from "@/lib/date";
import {
  buildPeopleTree,
  tagColors,
  UNTAGGED_COLOR,
  UNTAGGED_NAME,
  type PeopleTreemapGrouping,
} from "@/lib/people-treemap";
import { TREEMAP_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PEOPLE_TREEMAP_METHODOLOGY } from "@/lib/viz/methodology";
import { PEOPLE_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Legacy's `people_treemap`, rebuilt as InteractiveTreemap's first
// consumer (#213). Owns its page shell the way the other people charts
// do: the filters and the chart share state, and the tree is rebuilt
// client-side from the per-day lists so the range responds without a
// server round-trip.
//
// Legacy's date slider and play button — which scrubbed through the
// running count day by day — are the "potential future animation" #209
// noted and #213 deferred. The range picker covers the static half of
// that: pick a window and see who filled it.

const GROUPING_OPTIONS: GroupByOption<PeopleTreemapGrouping>[] = [
  { id: "tag", label: "Tag" },
  { id: "none", label: "None" },
];

export function PeopleTreemapChart({ data }: { data: PeopleDay[] }) {
  const [grouping, setGrouping] = useState<PeopleTreemapGrouping>("tag");
  const [range, setRange] = useState<[Date, Date] | null>(null);

  const domain = useMemo<[Date, Date] | null>(
    () => (data.length === 0 ? null : [parseDate(data[0].date), parseDate(data[data.length - 1].date)]),
    [data],
  );
  // Over the whole history, never the filtered range — see `tagColors`.
  const colors = useMemo(() => tagColors(data), [data]);

  const tree = useMemo(() => {
    // "YYYY-MM-DD" strings compare correctly as plain strings.
    const [from, to] = range ? [toDateString(range[0]), toDateString(range[1])] : [null, null];
    const scoped = from && to ? data.filter((day) => day.date >= from && day.date <= to) : data;
    return buildPeopleTree(scoped, grouping, colors);
  }, [data, range, grouping, colors]);

  // Ungrouped, a tile's colour still means its tag but nothing on the
  // chart says so any more — no panels, no headers — so the key comes
  // back. Grouped, the headers already are the key.
  const legend = useMemo<LegendSeries[]>(() => {
    if (grouping !== "none") return [];
    const hasUntagged = data.some((day) => day.people.some((person) => person.tagName === null));
    return [
      ...[...colors].map(([label, color]) => ({ label, color })),
      ...(hasUntagged ? [{ label: UNTAGGED_NAME, color: UNTAGGED_COLOR }] : []),
    ];
  }, [grouping, colors, data]);

  return (
    <ChartPage
      title="People Treemap"
      description="Everyone I've logged, sized by the days they were in, and grouped by how I know them."
      info={{
        interactionGuide: TREEMAP_INTERACTION_GUIDE,
        methodology: PEOPLE_TREEMAP_METHODOLOGY,
        trackingSpan: PEOPLE_TRACKING_SPAN,
      }}
      filters={
        domain ? (
          <>
            <GroupByPicker value={grouping} onChange={setGrouping} options={GROUPING_OPTIONS} label="Group by" />
            <TimeRangePicker domain={domain} value={range} onChange={setRange} />
          </>
        ) : null
      }
    >
      <ChartCard empty={tree === null}>
        {legend.length > 0 ? <Legend series={legend} className="mb-2 text-xs" /> : null}
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={280}>
          {({ width, height }) =>
            tree ? (
              <InteractiveTreemap
                data={tree}
                width={width}
                height={height}
                valueLabel="days"
                ariaLabel={
                  grouping === "tag"
                    ? "Treemap of everyone logged in the selected range, each tile sized by days logged and grouped by tag. Click a tile to zoom into its tag; press Escape or use the path above to zoom back out."
                    : "Treemap of everyone logged in the selected range, each tile sized by days logged and coloured by tag. Hover or focus a tile for its value."
                }
              />
            ) : null
          }
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
