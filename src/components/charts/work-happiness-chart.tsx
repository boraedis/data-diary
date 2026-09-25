"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { InteractiveStrip } from "@/components/charts/interactive/interactive-strip";
import type { ReferenceLine } from "@/components/charts/interactive/reference-lines";
import { categoricalColor } from "@/lib/viz/color";
import { STRIP_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { WORK_HAPPINESS_METHODOLOGY } from "@/lib/viz/methodology";
import { WORK_TRACKING_SPAN, DAY_TYPE_TRACKING_SPAN } from "@/lib/viz/tracking-span";
import { groupHappiness, type HappinessGrouping, type WorkDay } from "@/lib/work";

const GROUPING_OPTIONS: GroupByOption<HappinessGrouping>[] = [
  { id: "hours", label: "Hours worked" },
  { id: "productivity", label: "Productivity" },
  { id: "location", label: "Work location" },
  { id: "dayType", label: "Day type" },
];

const GROUPING_DESCRIPTIONS: Record<HappinessGrouping, string> = {
  hours: "Happiness on days grouped by how long I worked.",
  productivity: "Happiness on days grouped by how productive I rated the day.",
  location: "Happiness on days grouped by where I worked. A day split between places is its own group.",
  dayType: "Happiness on work days compared with days off, vacation and the rest.",
};

type ShowMode = "averages" | "days";

const SHOW_OPTIONS: GroupByOption<ShowMode>[] = [
  { id: "averages", label: "Averages" },
  { id: "days", label: "Every day" },
];

/** Happiness's own slot on the happiness charts isn't fixed across pages,
 * so this uses slot 3 — distinct from the three work measures (0–2) the
 * other Work charts use, so it doesn't read as one of them. */
const HAPPINESS_COLOR = categoricalColor(3);
const formatScore = (v: number) => `${Math.round(v)}%`;

/**
 * Work vs. Happiness (#444): average happiness per group, with its 95%
 * interval and sample size, against the average over every day shown.
 *
 * Deliberately descriptive, not causal, and the copy stays that way: a
 * 10-hour day and a low score can share a cause (a deadline) without one
 * causing the other.
 *
 * The groupings differ a lot in history. Hours, productivity and location
 * only exist since May 2026, while day type goes back to 2020, so the
 * tracking span shown follows the grouping.
 */
export function WorkHappinessChart({ data }: { data: WorkDay[] }) {
  const [grouping, setGrouping] = useState<HappinessGrouping>("hours");
  const [show, setShow] = useState<ShowMode>("averages");

  const groups = useMemo(() => groupHappiness(data, grouping), [data, grouping]);

  // The average across exactly the days on screen — not every day ever
  // logged — so "above the line" means "happier than the other days in
  // this comparison", not "happier than 2017".
  const referenceLines = useMemo<ReferenceLine[]>(() => {
    const values = groups.flatMap((g) => g.values.map((v) => v.value));
    if (values.length === 0) return [];
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return [{ value: mean, label: `All: ${formatScore(mean)}` }];
  }, [groups]);

  return (
    <ChartPage
      title="Work vs. Happiness"
      description={GROUPING_DESCRIPTIONS[grouping]}
      info={{
        interactionGuide: STRIP_INTERACTION_GUIDE,
        methodology: WORK_HAPPINESS_METHODOLOGY,
        trackingSpan: grouping === "dayType" ? DAY_TYPE_TRACKING_SPAN : WORK_TRACKING_SPAN,
      }}
      filters={
        <>
          <GroupByPicker value={grouping} onChange={setGrouping} options={GROUPING_OPTIONS} label="Group by" />
          <GroupByPicker value={show} onChange={setShow} options={SHOW_OPTIONS} label="Show" />
        </>
      }
    >
      <ChartCard empty={groups.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveStrip
              groups={groups}
              width={width}
              height={height}
              color={HAPPINESS_COLOR}
              showPoints={show === "days"}
              valueBounds={[0, 100]}
              valueFormat={formatScore}
              referenceLines={referenceLines}
              ariaLabel="Average happiness for each group, with a 95% interval and the number of days behind it. Use the up and down arrow keys to step through the groups."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
