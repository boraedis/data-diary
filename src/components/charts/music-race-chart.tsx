"use client";

import { useCallback, useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveBarRace } from "@/components/charts/interactive/interactive-bar-race";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { Legend } from "@/components/charts/interactive/legend";
import { AREA_TAIL_COLOR, categoricalColor } from "@/lib/viz/color";
import { formatHoursTotal, formatThousandsNumber, formatTitleCase } from "@/lib/viz/format";
import type { RaceFrame } from "@/lib/viz/race";
import type { GenreColoring, MusicRaceMode } from "@/lib/music-race";
import { BAR_RACE_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { MUSIC_RACE_METHODOLOGY } from "@/lib/viz/methodology";
import { MUSIC_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Music Race (#295) — artists racing by listening time, month by month. The
// server builds both standings (src/lib/music-race.ts); this picks between
// them, colours each bar by its artist's top genre, and hands InteractiveBarRace
// the frames. Same shape as PeopleRaceChart.

const MODE_OPTIONS: GroupByOption<MusicRaceMode>[] = [
  { id: "cumulative", label: "All time" },
  { id: "recent", label: "Recent" },
];

const RACE_TOP_N = 20;

/** Real hours when the figure is real hours; the recency-weighted one isn't,
 * so it's a bare number rather than something that looks like a duration. */
const FORMATTERS: Record<MusicRaceMode, (value: number) => string> = {
  cumulative: formatHoursTotal,
  recent: (value) => formatThousandsNumber(Math.round(value)),
};

const VALUE_LABELS: Record<MusicRaceMode, string> = {
  cumulative: "Listening time",
  recent: "Recency-weighted hours",
};

export function MusicRaceChart({
  frames,
  coloring,
}: {
  frames: Record<MusicRaceMode, RaceFrame[]>;
  coloring: GenreColoring;
}) {
  const [mode, setMode] = useState<MusicRaceMode>("cumulative");

  // Artists past the top five genres, and artists with none, share the
  // neutral — never a cycled hue (viz/color.ts).
  const color = useCallback(
    (label: string) => {
      const slot = coloring.slotByArtist[label];
      return slot === undefined ? AREA_TAIL_COLOR : categoricalColor(slot);
    },
    [coloring],
  );

  const legend = useMemo(
    () => [
      ...coloring.legend.map((l) => ({ id: l.genre, label: formatTitleCase(l.genre), color: categoricalColor(l.slot) })),
      { id: "__other__", label: "Other genres", color: AREA_TAIL_COLOR },
    ],
    [coloring],
  );

  return (
    <ChartPage
      title="Music Race"
      description="An animated ranking of the artists I've listened to most, month by month."
      info={{
        interactionGuide: BAR_RACE_INTERACTION_GUIDE,
        methodology: MUSIC_RACE_METHODOLOGY,
        trackingSpan: MUSIC_TRACKING_SPAN,
      }}
      filters={<GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="Ranking" />}
    >
      <ChartCard empty={frames[mode].length === 0}>
        <Legend series={legend} className="pb-2" />
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveBarRace
              // Restarts the race from the first frame when the standing changes.
              key={mode}
              frames={frames[mode]}
              topN={RACE_TOP_N}
              width={width}
              height={height}
              color={color}
              formatValue={FORMATTERS[mode]}
              valueLabel={VALUE_LABELS[mode]}
              ariaLabel={
                mode === "cumulative"
                  ? "Animated ranking of artists by total listening time so far, month by month."
                  : "Animated ranking of artists by recency-weighted listening time, month by month."
              }
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
