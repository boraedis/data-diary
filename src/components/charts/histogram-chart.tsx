"use client";

import { useMemo } from "react";
import { SplitHistExplorer } from "@/components/charts/split-hist-explorer";
import type { HappinessHistDay } from "@/lib/charts";
import type { DaySplit } from "@/lib/day-split";
import { categoricalColor } from "@/lib/viz/color";
import { HAPPINESS_METHODOLOGY } from "@/lib/viz/methodology";
import { HAPPINESS_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Happiness charts are green — an explicit, deliberate choice for this
// chart's identity (a single-series chart, not a multi-series categorical
// assignment the dataviz skill's fixed-slot-order rule governs), not the
// toolkit default. Same choice made in happiness-averager-chart.tsx for the
// trend line, so every "happiness" chart reads the same color.
const HAPPINESS_COLOR = categoricalColor(2);
/** The same work-day/other pair Happiness Trend's work-day split uses
 * (#415): a mustardy olive for work days against happiness's own green, so
 * the split reads as "one metric, two conditions" — see globals.css's
 * comment on `--metric-happiness-workday` for its colorblind validation.
 * The weekend split reuses it (weekdays olive, weekends green) rather than
 * introducing a second pair for the same metric. */
const HAPPINESS_SIDE_COLORS: readonly [string, string] = ["var(--metric-happiness-workday)", HAPPINESS_COLOR];
const HAPPINESS_BOUNDS: [number, number] = [0, 100];

const DESCRIPTIONS: Record<DaySplit, string> = {
  none: "The distribution of happiness ratings across every day logged.",
  work: "Happiness on work days against every other kind of day — days off, vacation, travel and the rest.",
  weekend: "Happiness on weekdays against weekends.",
};

const formatScore = (v: number) => `${v.toFixed(1)}%`;
const countDays = (n: number) => `day${n === 1 ? "" : "s"}`;

/** Happiness Histogram — one bucket per whole point (buckets of 10 read as
 * too coarse; every integer value gets its own bar) over just the range of
 * values actually logged, not the full fixed 0-100 scale, so the chart
 * doesn't spend most of its width on buckets nobody has an entry in.
 * Splittable by work day or weekend (see SplitHistExplorer). */
export function HappinessHistChart({ data }: { data: HappinessHistDay[] }) {
  const days = useMemo(() => data.map((d) => ({ date: d.date, dayType: d.dayType, value: d.happiness })), [data]);

  return (
    <SplitHistExplorer
      data={days}
      title="Happiness Histogram"
      descriptions={DESCRIPTIONS}
      methodology={HAPPINESS_METHODOLOGY}
      trackingSpan={HAPPINESS_TRACKING_SPAN}
      color={HAPPINESS_COLOR}
      sideColors={HAPPINESS_SIDE_COLORS}
      step={1}
      bounds={HAPPINESS_BOUNDS}
      formatValue={formatScore}
      countLabel={countDays}
      ariaLabel="Happiness distribution histogram. Hover a bar to see its range and count."
    />
  );
}
