"use client";

import { useEffect, useMemo, useState } from "react";
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
  tagColors,
  UNTAGGED_COLOR,
  UNTAGGED_NAME,
  type PeopleTreemapGrouping,
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

const GROUPING_OPTIONS: GroupByOption<PeopleTreemapGrouping>[] = [
  { id: "tag", label: "Tag" },
  { id: "none", label: "None" },
];

export function PeopleTreemapChart({ data }: { data: PeopleDay[] }) {
  const [grouping, setGrouping] = useState<PeopleTreemapGrouping>("tag");
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
  // The end state. Also handed to the treemap as its layout seed, so the
  // tiles' arrangement is the one that reads best where playback stops.
  const fullTree = useMemo(() => buildPeopleTree(data, grouping, colors), [data, grouping, colors]);

  const tree = useMemo(() => {
    if (frame === null || atEnd) return fullTree;
    // "YYYY-MM-DD" strings compare correctly as plain strings.
    const through = frames[frame];
    return buildPeopleTree(
      data.filter((day) => day.date <= through),
      grouping,
      colors,
      data,
    );
  }, [frame, atEnd, fullTree, frames, data, grouping, colors]);

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
      description="Everyone I've logged, sized by the days they were in, and grouped by how I know them. Press Play to watch it grow."
      info={{
        interactionGuide: TREEMAP_INTERACTION_GUIDE,
        methodology: PEOPLE_TREEMAP_METHODOLOGY,
        trackingSpan: PEOPLE_TRACKING_SPAN,
      }}
      filters={<GroupByPicker value={grouping} onChange={setGrouping} options={GROUPING_OPTIONS} label="Group by" />}
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
            {shownDate && !isPlaying ? `Showing everyone logged through ${shownDate}` : ""}
          </div>
          <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport="below-filters" minWidth={280}>
            {({ width, height }) =>
              tree ? (
                <InteractiveTreemap
                  data={tree}
                  layoutSeed={fullTree ?? undefined}
                  // While playing, each tween lasts exactly one frame, so
                  // the growth reads as one continuous motion.
                  transitionMs={isPlaying ? 1000 / framesPerSecond : undefined}
                  width={width}
                  height={height}
                  valueLabel="days"
                  ariaLabel={
                    grouping === "tag"
                      ? "Treemap of everyone logged, each tile sized by days logged and grouped by tag. Click a tile to zoom into its tag; press Escape or use the path above to zoom back out."
                      : "Treemap of everyone logged, each tile sized by days logged and coloured by tag. Hover or focus a tile for its value."
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
