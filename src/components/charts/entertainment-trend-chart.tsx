"use client";

import { useState } from "react";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration, formatHoursTotal } from "@/lib/viz/format";
import { ENTERTAINMENT_TYPE_LABELS, ENTERTAINMENT_TYPE_ORDER, type EntertainmentType } from "@/lib/entertainment-types";
import type { EntertainmentDay } from "@/lib/charts";
import { ENTERTAINMENT_METHODOLOGY } from "@/lib/viz/methodology";
import { ENTERTAINMENT_TREND_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Entertainment Trend (#479) — total time on movies, TV, books, sports,
// games and the user-added kinds, as one line over time. A thin
// TrendExplorer wrapper: see coffee-charts.tsx for why this client layer
// exists at all.
//
// The line is the **average per day** across each period, not the period's
// sum — the call Exercise Trend made in #411: a 31-day month and a 28-day
// one with identical habits shouldn't draw different heights. The period's
// total is still there, in the tooltip. Every day counts, including the
// zero-filled ones (see `getEntertainmentDailyData`), so the average is
// "time per calendar day," not "time per day something was watched."
//
// "Medium" swaps the total for one line per type, which #479 left optional
// "if it stays readable". It does as a separate mode, not as extra lines
// beside the total: the total is the sum of the six, so drawing both puts
// one line far above a tangle of small ones and squashes them. The stacked
// by-medium share over time is #222's area chart, not this.

type GroupBy = "none" | "medium";

const GROUP_BY_OPTIONS: GroupByOption<GroupBy>[] = [
  { id: "none", label: "None" },
  { id: "medium", label: "Medium" },
];

const total = (d: EntertainmentDay) => ENTERTAINMENT_TYPE_ORDER.reduce((sum, type) => sum + d[type], 0);

/** Each type keeps the leaderboard's slot (`entertainmentTypeColor`);
 * "Other" is the sixth, which `categoricalColor` renders as the muted
 * neutral rather than a new hue. */
const typeSeries = (type: EntertainmentType, index: number) => ({
  id: type,
  label: ENTERTAINMENT_TYPE_LABELS[type],
  color: categoricalColor(index),
  getValue: (d: EntertainmentDay) => d[type],
});

export function EntertainmentTrendChart({ data }: { data: EntertainmentDay[] }) {
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const byMedium = groupBy === "medium";
  const [first, ...rest] = ENTERTAINMENT_TYPE_ORDER.map(typeSeries);

  return (
    <TrendExplorer
      data={data}
      title="Entertainment Trend"
      description="Average daily time on entertainment — movies, TV, books, sports, games and more — aggregated by period. Break it down by medium, and toggle the legend down to one line to see its ±1 standard deviation band."
      methodology={ENTERTAINMENT_METHODOLOGY}
      trackingSpan={ENTERTAINMENT_TREND_TRACKING_SPAN}
      // Swapping the primary series' id/label is what makes TrendExplorer
      // recompute on a mode change — see its `primaryKey`.
      seriesId={byMedium ? first.id : "total"}
      label={byMedium ? first.label : "Entertainment"}
      color={byMedium ? first.color : categoricalColor(0)}
      getValue={byMedium ? first.getValue : total}
      extraSeries={byMedium ? rest : undefined}
      aggregate="mean"
      valueFormat={formatDuration}
      // Only for the total line: `tooltipLabel` is shared by every series
      // and isn't told which one it's labelling, so a per-medium total
      // can't be given here. Those rows keep the default day count.
      tooltipLabel={
        byMedium
          ? undefined
          : (items) => `${formatHoursTotal(items.reduce((sum, d) => sum + total(d), 0))} total, ${items.length} day${items.length === 1 ? "" : "s"}`
      }
      extraFilters={<GroupByPicker value={groupBy} onChange={setGroupBy} options={GROUP_BY_OPTIONS} label="Break down by" />}
      ariaLabel="Average daily entertainment time over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}
