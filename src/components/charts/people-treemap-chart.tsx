"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { InteractiveTreemap } from "@/components/charts/interactive/interactive-treemap";
import { Legend, type LegendSeries } from "@/components/charts/interactive/legend";
import {
  PLAYBACK_SPEEDS,
  PlaybackControls,
  type PlaybackSpeedId,
} from "@/components/charts/interactive/playback-controls";
import type { PeopleDay } from "@/lib/charts";
import { parseDate, toDateString } from "@/lib/date";
import { monthlyFrameEnds } from "@/lib/people-network";
import {
  buildPeopleTree,
  dayCounts,
  fadedImpactAt,
  lifetimeImpact,
  scoreDays,
  tagColors,
  UNTAGGED_COLOR,
  UNTAGGED_NAME,
  type PeopleTreemapGrouping,
  type PeopleTreemapMetric,
} from "@/lib/people-treemap";
import { formatDate } from "@/lib/viz/format";
import { TREEMAP_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PEOPLE_TREEMAP_METHODOLOGY } from "@/lib/viz/methodology";
import { PEOPLE_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Legacy's `people_treemap`, rebuilt as InteractiveTreemap's first
// consumer (#213). Owns its page shell the way the other people charts
// do: the filters and the chart share state, and the tree is rebuilt
// client-side from the per-day lists so playback needs no server
// round-trip.
//
// The time-lapse is legacy's own feature: a date slider and a Play button
// that ran each person's count forward from the first logged day. Here it
// steps a month at a time (the network's `monthlyFrameEnds`, and the same
// shared control row), and each frame *tweens* into the next rather than
// redrawing: every frame is the same tree — everyone in the history, with
// zeros for people not yet met — so the treemap re-sizes tiles in place.
// The scrubber replaced the earlier time-range picker: two time controls
// on one chart only argued with each other (the network found the same,
// on #437).
//
// Size by Impact uses the People Race's recency-faded score, re-faded at
// each frame's date the way each race frame is — see `fadedImpactAt`. It's
// the metric that makes the time-lapse more than growth: tiles swell while
// someone's in my days and shrink back as they fade. Its time-lapse layout
// seed is the lifetime total rather than the end state, for the reason on
// `lifetimeImpact`.

const GROUPING_OPTIONS: GroupByOption<PeopleTreemapGrouping>[] = [
  { id: "tag", label: "Tag" },
  { id: "none", label: "None" },
];

const METRIC_OPTIONS: GroupByOption<PeopleTreemapMetric>[] = [
  { id: "days", label: "Days" },
  { id: "impact", label: "Impact" },
];

/** Whole numbers, as the People Race shows the same score — module-level
 * so its identity is stable (it's a treemap redraw dependency). */
const formatImpactScore = (value: number) => Math.round(value).toLocaleString();

export function PeopleTreemapChart({ data }: { data: PeopleDay[] }) {
  const [grouping, setGrouping] = useState<PeopleTreemapGrouping>("tag");
  const [metric, setMetric] = useState<PeopleTreemapMetric>("days");
  // Indexes `frames`; null is the static, whole-history view — which is
  // also exactly what the last frame shows.
  const [frame, setFrame] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeedId>("normal");

  const frames = useMemo(
    () =>
      data.length === 0
        ? []
        : monthlyFrameEnds(parseDate(data[0].date), parseDate(data[data.length - 1].date)).map(toDateString),
    [data],
  );
  const lastFrame = frames.length - 1;
  const atEnd = frame !== null && frame >= lastFrame;
  const isPlaying = playing && !atEnd;
  const framesPerSecond = PLAYBACK_SPEEDS.find((option) => option.id === speed)!.framesPerSecond;

  // Over the whole history, never a frame — see `tagColors`.
  const colors = useMemo(() => tagColors(data), [data]);
  const scored = useMemo(() => scoreDays(data), [data]);
  const lastDate = data.length > 0 ? data[data.length - 1].date : null;

  /** Each person's value as of `through` ("YYYY-MM-DD"), or over the whole
   * history for `null`. Days are a running count; impact is re-faded
   * relative to that date, the way each of the race's frames is. */
  const valuesThrough = useCallback(
    (through: string | null) => {
      if (metric === "impact") return fadedImpactAt(scored, through ?? lastDate ?? "");
      // "YYYY-MM-DD" strings compare correctly as plain strings.
      return dayCounts(through === null ? data : data.filter((day) => day.date <= through));
    },
    [metric, scored, lastDate, data],
  );

  const tree = useMemo(
    () => buildPeopleTree(data, valuesThrough(frame === null || atEnd ? null : frames[frame]), grouping, colors),
    [data, valuesThrough, frame, atEnd, frames, grouping, colors],
  );

  // The time-lapse's layout seed: what decides the tiles' arrangement
  // while frames play or the scrubber is parked (see InteractiveTreemap's
  // `layoutSeed`). For days that's simply the end state; for impact it's
  // the lifetime total, so someone who mattered most years ago still has
  // room to swell into — see `lifetimeImpact`.
  const timeLapseSeed = useMemo(
    () => buildPeopleTree(data, metric === "days" ? dayCounts(data) : lifetimeImpact(scored), grouping, colors),
    [data, metric, scored, grouping, colors],
  );
  // Outside the time-lapse there's nothing to keep stable across frames,
  // so the arrangement is simply the best one for what's on screen. That
  // matters for impact: today's faded scores laid into rows sized for
  // lifetime totals leave the people who've drifted away as slivers. The
  // switch costs one re-arranging slide as Play starts, and none after.
  const layoutSeed = frame === null ? tree : timeLapseSeed;

  // The clock. Stops on its own at the last frame rather than looping —
  // the end state is everyone, which is the natural place to stop.
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setFrame((f) => Math.min(lastFrame, (f ?? -1) + 1));
    }, 1000 / framesPerSecond);
    return () => window.clearInterval(id);
  }, [isPlaying, framesPerSecond, lastFrame]);

  const handlePlayPause = () => {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    // From the static view or the end, Play starts over from the first
    // month — the time-lapse is about watching it grow.
    if (frame === null || atEnd) setFrame(0);
    setPlaying(true);
  };

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

  const shownDate = frame !== null && frames[frame] ? formatDate(frames[frame], "monthYear") : null;

  return (
    <ChartPage
      title="People Treemap"
      description="Everyone I've logged, sized by the days they were in or by how much they mattered, and grouped by how I know them. Press Play to watch it change."
      info={{
        interactionGuide: TREEMAP_INTERACTION_GUIDE,
        methodology: PEOPLE_TREEMAP_METHODOLOGY,
        trackingSpan: PEOPLE_TRACKING_SPAN,
      }}
      filters={
        <>
          <GroupByPicker value={metric} onChange={setMetric} options={METRIC_OPTIONS} label="Size by" />
          <GroupByPicker value={grouping} onChange={setGrouping} options={GROUPING_OPTIONS} label="Group by" />
        </>
      }
    >
      <ChartCard empty={tree === null}>
        <div className="flex flex-col gap-3">
          {legend.length > 0 || shownDate ? (
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              {legend.length > 0 ? <Legend series={legend} className="text-xs" /> : <span />}
              {shownDate ? (
                // The frame's date, large and quiet — the network's and the
                // bar race's period label. Beside the chart rather than over
                // it, since a treemap has no empty corner to put it in.
                <span
                  aria-hidden
                  className="font-heading text-2xl text-muted-foreground/70 tabular-nums select-none md:text-3xl"
                >
                  {shownDate}
                </span>
              ) : null}
            </div>
          ) : null}
          {/* Announced once playback settles (paused or scrubbed), not on
              every frame — the network's and bar race's rule. */}
          <div role="status" aria-live="polite" className="sr-only">
            {shownDate && !isPlaying ? `Showing everyone as of ${shownDate}` : ""}
          </div>
          <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport="below-filters" minWidth={280}>
            {({ width, height }) =>
              tree ? (
                <InteractiveTreemap
                  data={tree}
                  layoutSeed={layoutSeed ?? undefined}
                  // While playing, each tween lasts exactly one frame, so
                  // the growth reads as one continuous motion.
                  transitionMs={isPlaying ? 1000 / framesPerSecond : undefined}
                  width={width}
                  height={height}
                  valueLabel={metric === "days" ? "days" : "impact"}
                  formatValue={metric === "days" ? undefined : formatImpactScore}
                  ariaLabel={
                    grouping === "tag"
                      ? `Treemap of everyone logged, each tile sized by ${metric === "days" ? "days logged" : "recency-faded impact"} and grouped by tag. Click a tile to zoom into its tag; press Escape or use the path above to zoom back out.`
                      : `Treemap of everyone logged, each tile sized by ${metric === "days" ? "days logged" : "recency-faded impact"} and coloured by tag. Hover or focus a tile for its value.`
                  }
                />
              ) : null
            }
          </ResponsiveChart>
          {frames.length > 1 ? (
            <PlaybackControls
              playing={isPlaying}
              frame={frame ?? lastFrame}
              lastFrame={lastFrame}
              speed={speed}
              onPlayPause={handlePlayPause}
              onRestart={() => {
                setFrame(0);
                setPlaying(true);
              }}
              onScrub={(f) => {
                setPlaying(false);
                setFrame(f);
              }}
              onSpeed={setSpeed}
              startLabel={formatDate(frames[0], "monthYear")}
              endLabel={formatDate(frames[lastFrame], "monthYear")}
            />
          ) : null}
        </div>
      </ChartCard>
    </ChartPage>
  );
}
