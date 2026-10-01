"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveBump } from "@/components/charts/interactive/interactive-bump";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { AREA_TAIL_COLOR, CATEGORICAL_SLOT_COUNT, categoricalColor } from "@/lib/viz/color";
import { BUMP_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { RANKING_RIBBON_METHODOLOGY } from "@/lib/viz/methodology";
import { RIBBON_SIZE, type Ribbon, type RankingList } from "@/lib/ranking-ribbon";

// Ranking Ribbon (#222) — how the top-10 films (or books) shifted from year
// to year, rebuilt from the ranking history log (#546). One page with a
// picker rather than a page per list: the two are the same chart over
// different logs, and the history is the same shape for both.

const LIST_OPTIONS: GroupByOption<RankingList>[] = [
  { id: "movie", label: "Movies" },
  { id: "book", label: "Books" },
];

const NOUN: Record<RankingList, string> = { movie: "films", book: "books" };

export function RankingRibbonChart({ ribbons }: { ribbons: Record<RankingList, Ribbon> }) {
  const [list, setList] = useState<RankingList>("movie");
  const ribbon = ribbons[list];

  // Series arrive in first-appearance order, so an item's colour is its
  // place in that order and never changes as history grows: the first five
  // take the palette's fixed slots, everything after is the muted neutral
  // (never a cycled hue — viz/color.ts). The names and hover do the rest.
  const series = useMemo(
    () =>
      ribbon.series.map((s, i) => ({
        ...s,
        color: i < CATEGORICAL_SLOT_COUNT ? categoricalColor(i) : AREA_TAIL_COLOR,
      })),
    [ribbon.series],
  );
  const columns = useMemo(() => ribbon.columns.map((c) => c.label), [ribbon.columns]);

  return (
    <ChartPage
      title="Ranking Ribbon"
      description={`How my top ${RIBBON_SIZE} ${NOUN[list]} shifted from year to year.`}
      info={{
        interactionGuide: BUMP_INTERACTION_GUIDE,
        methodology: RANKING_RIBBON_METHODOLOGY,
        trackingSpan: ribbon.since
          ? {
              start: ribbon.since,
              note: "My rankings were only stored as a current list before this, so there's no earlier history to draw.",
            }
          : undefined,
      }}
      filters={<GroupByPicker value={list} onChange={setList} options={LIST_OPTIONS} label="Ranking" />}
    >
      <ChartCard empty={ribbon.columns.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={240}>
          {({ width, height }) => (
            <InteractiveBump
              columns={columns}
              series={series}
              maxRank={RIBBON_SIZE}
              width={width}
              height={height}
              ariaLabel={`Ribbon chart of my top ${RIBBON_SIZE} ${NOUN[list]} at the end of each year. Focus it and use the arrow keys to step through each ribbon, or hover one to see its rank in every year.`}
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
