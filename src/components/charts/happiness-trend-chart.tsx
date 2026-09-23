"use client";

import { useMemo, useState } from "react";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { categoricalColor } from "@/lib/viz/color";
import { HAPPINESS_METHODOLOGY } from "@/lib/viz/methodology";
import { HAPPINESS_TRACKING_SPAN } from "@/lib/viz/tracking-span";
import type { DayType } from "@/db/schema";

/**
 * Trend in happiness over time, aggregated by period — the legacy
 * "Averager" pattern (functions/views/vis/charts/happiness_averager.js),
 * now a thin wrapper around the shared `TrendExplorer` (#18/#403) instead
 * of its own bespoke monthly-only implementation. That migration is what
 * gets this chart, for free, everything the bespoke version didn't have:
 * a period picker (week/month/quarter/year, not just month), a date-range
 * picker, a y-axis that auto-domains to the visible line instead of a
 * fixed [0, 100], and a ±1 std-dev band instead of min/max (see
 * TrendExplorer's own comment on why std dev reads spread more honestly
 * than min/max, which just widens with bucket size).
 *
 * The work-day split (#410) is what legacy's own Averager could do that
 * the first TrendExplorer-less pass at this chart (#18) explicitly left
 * out, pending "a second grouping dimension this first pass doesn't have
 * a UI for yet" (see getHappinessTrendData's own comment) — TrendExplorer's
 * `extraSeries` (added for #403's sleep-naps split) is that UI, arriving
 * later than the placeholder comment predicted but for the reason it
 * predicted.
 */

const HAPPINESS_COLOR = categoricalColor(2);
// Mustardy variant of that same green for the work-day line — see
// globals.css's own comment on `--metric-happiness-workday` for why this
// is a dedicated, validated token rather than a categoricalColor slot: the
// two need to read as "one metric, two conditions," not two unrelated
// series, and a green/olive pair needed real color-vision-deficiency
// validation to land somewhere that still separates from pure green.
const WORKDAY_COLOR = "var(--metric-happiness-workday)";

export type HappinessTrendPoint = {
  date: string;
  happiness: number;
  /** `days.dayType`, or omitted/null on the public site (see
   * getPublicHappinessTrendData's own comment) — the work-day split is
   * private-only, same reasoning as SleepCalendarChart's naps toggle. */
  dayType?: DayType | null;
};

type HappinessSplit = "all" | "workday";

const SPLIT_OPTIONS: GroupByOption<HappinessSplit>[] = [
  { id: "all", label: "All Days" },
  { id: "workday", label: "By Work Day" },
];

export function HappinessTrendChart({
  data,
  backHref,
  backLabel,
}: {
  data: HappinessTrendPoint[];
  backHref?: string;
  backLabel?: string;
}) {
  // Only offered where day-type is actually recorded — most callers (and
  // the entire public site, which never fetches dayType at all) have
  // none, and a toggle with no effect is worse than no toggle.
  const hasDayType = useMemo(() => data.some((d) => d.dayType != null), [data]);
  const [split, setSplit] = useState<HappinessSplit>("all");
  const effectiveSplit = hasDayType ? split : "all";

  return (
    <TrendExplorer
      data={data}
      title="Happiness Trend"
      description="Trend in happiness over time, aggregated by period. Marker size shows how many days fed each point; the band shows ±1 standard deviation around it."
      methodology={HAPPINESS_METHODOLOGY}
      trackingSpan={HAPPINESS_TRACKING_SPAN}
      seriesId={effectiveSplit === "workday" ? "workday" : "happiness"}
      label={effectiveSplit === "workday" ? "Work Days" : "Happiness"}
      color={effectiveSplit === "workday" ? WORKDAY_COLOR : HAPPINESS_COLOR}
      getValue={(day) =>
        effectiveSplit === "workday" ? (day.dayType === "work" ? day.happiness : undefined) : day.happiness
      }
      extraSeries={
        effectiveSplit === "workday"
          ? [
              {
                id: "other",
                label: "Other Days",
                color: HAPPINESS_COLOR,
                getValue: (day) => (day.dayType !== "work" ? day.happiness : undefined),
              },
            ]
          : undefined
      }
      aggregate="mean"
      valueFormat={(v) => v.toFixed(1)}
      extraFilters={
        hasDayType ? (
          <GroupByPicker value={effectiveSplit} onChange={setSplit} options={SPLIT_OPTIONS} label="Split" />
        ) : undefined
      }
      backHref={backHref}
      backLabel={backLabel}
      ariaLabel="Average happiness over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}
