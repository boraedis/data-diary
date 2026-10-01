"use client";

import { TrendExplorer } from "@/components/charts/trend-explorer";
import { categoricalColor } from "@/lib/viz/color";
import { formatThousandsNumber } from "@/lib/viz/format";
import type { BacklogDay } from "@/lib/tv-backlog";
import { TV_BACKLOG_METHODOLOGY } from "@/lib/viz/methodology";
import { TV_BACKLOG_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// TV Backlog (#222) — aired-but-unwatched episodes of shows I follow, over
// time. A thin TrendExplorer wrapper like EntertainmentTrendChart. The
// backlog is a *stock* (a level on a given day), so a period's point is the
// **mean** level across its days — not a sum, which would add the same
// unwatched episode up once per day. No ±1 std-dev band: within a period
// that spread is just the backlog moving, which the line already shows.

const episodes = (n: number) => `${formatThousandsNumber(Math.round(n))} unwatched`;

export function TvBacklogChart({ data }: { data: BacklogDay[] }) {
  return (
    <TrendExplorer
      data={data}
      title="TV Backlog"
      description="How many aired episodes of the shows I follow were still unwatched, averaged over each period."
      methodology={TV_BACKLOG_METHODOLOGY}
      trackingSpan={TV_BACKLOG_TRACKING_SPAN}
      seriesId="backlog"
      label="Unwatched episodes"
      color={categoricalColor(0)}
      getValue={(d) => d.backlog}
      aggregate="mean"
      band={false}
      yMin={0}
      valueFormat={episodes}
      ariaLabel="Unwatched TV episodes of followed shows over time, averaged by period. Hover or focus the line to inspect values."
    />
  );
}
