"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { InteractiveHist, type HistMode, type HistSeries } from "@/components/charts/interactive/interactive-hist";
import { splitDays, type DaySplit, type SplittableDay } from "@/lib/day-split";
import { categoricalColor } from "@/lib/viz/color";
import { formatThousandsNumber } from "@/lib/viz/format";
import { HIST_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { DAY_TYPE_TRACKING_SPAN, type TrackingSpan } from "@/lib/viz/tracking-span";

// SplitHistExplorer — the page shell for a histogram that can be split into
// two overlaid/stacked distributions by what kind of day each value belongs
// to (Happiness Histogram, Sleep Histogram). Same role TrendExplorer plays
// for trend charts: the filters and the chart share state, so the whole page
// is one client component, and each chart's own thin wrapper supplies the
// formatters a server page can't pass across the boundary.

export type SplitHistDay = SplittableDay & { value: number };

const SPLIT_OPTIONS: GroupByOption<DaySplit>[] = [
  { id: "none", label: "None" },
  { id: "work", label: "Work day" },
  { id: "weekend", label: "Weekend" },
];

const MODE_OPTIONS: GroupByOption<HistMode>[] = [
  { id: "share", label: "Share" },
  { id: "overlaid", label: "Count" },
  { id: "stacked", label: "Stacked" },
];

/** Blue then orange for the two sides of a split, on every split chart —
 * the most distinct pair in the palette (hue 225 vs. 40, and the classic
 * colorblind-safe pairing), which matters more here than anywhere else
 * because overlaid layers have to stay separable where they blend. Fixed by
 * side, not by chart: "Work days" is blue on the happiness and sleep pages
 * alike. */
const SIDE_COLORS = [categoricalColor(4), categoricalColor(0)] as const;

/** Module-level so the default keeps one identity (it's a memo dependency). */
const identityLabel = (label: string) => label;

export type SplitHistExplorerProps = {
  data: SplitHistDay[];
  title: string;
  /** Page description per split — the unsplit chart and each comparison
   * say different things about what's drawn. */
  descriptions: Record<DaySplit, string>;
  methodology: string;
  trackingSpan: TrackingSpan;
  /** Unsplit bar color — the chart's own identity color. */
  color: string;
  /** Bucket width, in the value's own unit (1 point, a quarter hour). */
  step: number;
  /** Hard bounds the padded domain is clipped to (0–100 for happiness). */
  bounds: [number, number];
  /** Extra buckets of air either side of the data's own extent, so the
   * outermost bars aren't flush against the axis edge. */
  paddingSteps?: number;
  /** Rewords a side's label for this chart — sleep's "Before work days". */
  sideLabel?: (label: string) => string;
  formatRange?: (x0: number, x1: number) => string;
  xTickFormat?: (value: number) => string;
  formatValue: (value: number) => string;
  countLabel: (count: number) => string;
  ariaLabel: string;
};

export function SplitHistExplorer({
  data,
  title,
  descriptions,
  methodology,
  trackingSpan,
  color,
  step,
  bounds,
  paddingSteps = 3,
  sideLabel = identityLabel,
  formatRange,
  xTickFormat,
  formatValue,
  countLabel,
  ariaLabel,
}: SplitHistExplorerProps) {
  const [split, setSplit] = useState<DaySplit>("none");
  const [mode, setMode] = useState<HistMode>("share");

  // The domain follows every value logged, not just the split's: the work
  // split drops untyped days, and the axis shouldn't shift under the reader
  // when they flip between splits. Edges are built as integer multiples of
  // `step` rather than by repeated addition, so a 0.25h step doesn't drift
  // into 7.749999 edges.
  const { domain, thresholds } = useMemo(() => {
    const [min, max] = data.length ? (d3.extent(data, (d) => d.value) as [number, number]) : bounds;
    const lo = Math.max(bounds[0], (Math.floor(min / step) - paddingSteps) * step);
    const hi = Math.min(bounds[1], (Math.ceil(max / step) + paddingSteps) * step);
    const n = Math.round((hi - lo) / step);
    return {
      domain: [lo, hi] as [number, number],
      thresholds: d3.range(n + 1).map((i) => lo + i * step),
    };
  }, [data, bounds, step, paddingSteps]);

  const series = useMemo<HistSeries[] | undefined>(() => {
    if (split === "none") return undefined;
    return splitDays(data, split).map((group, i) => ({
      id: group.id,
      // n in the legend: the two sides are rarely close in size, and that
      // is what "Share" vs. "Count" is about.
      label: `${sideLabel(group.label)} · ${formatThousandsNumber(group.days.length)}`,
      color: SIDE_COLORS[i],
      values: group.days.map((d) => d.value),
    }));
  }, [data, split, sideLabel]);

  const values = useMemo(() => data.map((d) => d.value), [data]);

  // Day types start later than most fields, so the work split's honest
  // span is whichever of the two started last.
  const span =
    split === "work" && DAY_TYPE_TRACKING_SPAN.start > trackingSpan.start ? DAY_TYPE_TRACKING_SPAN : trackingSpan;

  return (
    <ChartPage
      title={title}
      description={descriptions[split]}
      info={{ interactionGuide: HIST_INTERACTION_GUIDE, methodology, trackingSpan: span }}
      filters={
        <>
          <GroupByPicker value={split} onChange={setSplit} options={SPLIT_OPTIONS} label="Split by" />
          {split !== "none" ? <GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="Show" /> : null}
        </>
      }
    >
      <ChartCard empty={data.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveHist
              values={values}
              series={series}
              mode={mode}
              width={width}
              height={height}
              domain={domain}
              thresholds={thresholds}
              color={color}
              // Dense buckets already read as touching at most container
              // widths; let bars fill their slot rather than inheriting the
              // toolkit's 24px cap (meant for a handful of wide category
              // bars, not a dense distribution).
              maxBarThickness={Infinity}
              barGap={1}
              formatRange={formatRange}
              xTickFormat={xTickFormat}
              countLabel={countLabel}
              showMeans
              formatValue={formatValue}
              ariaLabel={ariaLabel}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
