"use client";

import { TrendExplorer } from "@/components/charts/trend-explorer";
import { categoricalColor } from "@/lib/viz/color";
import { formatDuration } from "@/lib/viz/format";
import type { TrainingDay } from "@/lib/charts";
import { TRAINING_METHODOLOGY } from "@/lib/viz/methodology";

/**
 * Training volume as total time trained per bucket.
 *
 * `aggregate="sum"`, unlike the coffee and distance trends: this is a
 * volume, not a rate. That also drops the range band, which would show the
 * spread of the parts rather than anything about the total being drawn.
 *
 * Days trained, exercise count and average session length ride in the
 * tooltip, which answers "sum or average" in one chart — the line is the
 * bucket's total, the tooltip is the same data read the other way. They
 * aren't extra series because tens of hours, ~31 days and hundreds of
 * exercises are three different scales, and a second y-axis is the one
 * thing these charts never do.
 */
export function TrainingVolumeChart({ data }: { data: TrainingDay[] }) {
  return (
    <TrendExplorer
      data={data}
      title="Exercise Trend"
      description="Trend in training hours over time, aggregated by period. Hover a point for the days, exercises and average session length behind it."
      methodology={TRAINING_METHODOLOGY}
      seriesId="training"
      label="Time trained"
      color={categoricalColor(1)}
      getValue={(d) => d.minutes / 60}
      aggregate="sum"
      valueFormat={(hours) => formatDuration(hours)}
      tooltipLabel={(items) => {
        const trained = items.filter((d) => d.exercises > 0);
        const exercises = trained.reduce((n, d) => n + d.exercises, 0);
        if (exercises === 0) return "no training logged";
        const minutes = trained.reduce((n, d) => n + d.minutes, 0);
        return `${trained.length} day${trained.length === 1 ? "" : "s"}, ${exercises} exercise${exercises === 1 ? "" : "s"}, ~${Math.round(minutes / exercises)} min each`;
      }}
      ariaLabel="Time trained over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}
