"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveArea, type InteractiveAreaCategory, type InteractiveAreaMode, type InteractiveAreaPoint } from "@/components/charts/interactive/interactive-area";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { parseDate, toDateString } from "@/lib/date";
import { CATEGORICAL_SLOT_COUNT, categoricalColor } from "@/lib/viz/color";
import { formatDate, formatThousandsNumber } from "@/lib/viz/format";
import type { BacklogSeries } from "@/lib/tv-backlog";
import { AREA_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { TV_BACKLOG_METHODOLOGY } from "@/lib/viz/methodology";
import { TV_BACKLOG_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// TV Backlog (#222) — aired-but-unwatched episodes of shows I follow, one
// band per show, one point per day. The backlog is a *level*, so each day
// stands for itself: there's no period picker, because averaging a level
// across a week would blur exactly the steps (a show started, a season
// binged) this chart exists to show. A band's height is that show's
// unwatched episodes on the day; the stack is the whole backlog.

const VIEW_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "stacked", label: "Episodes" },
  { id: "proportional", label: "% share" },
];

const episodes = (n: number) => `${formatThousandsNumber(Math.round(n))} unwatched`;
const dayTitle = (x: Date) => formatDate(toDateString(x), "dayYear");

export function TvBacklogChart({ series }: { series: BacklogSeries }) {
  const [mode, setMode] = useState<InteractiveAreaMode>("stacked");
  const [range, setRange] = useState<[Date, Date] | null>(null);
  const { bands, days } = series;
  // Every show gets a colour, cycling through the five palette slots in
  // band order (biggest first), so neighbouring bands never match. This
  // departs on purpose from the app's rule that categorical hues aren't
  // cycled (viz/color.ts): a backlog spans dozens of shows, and the muted
  // tail the primitive would otherwise use for all but five of them made
  // most of the chart one undifferentiated beige. Colour alone doesn't
  // identify a show here — the tooltip and in-band labels do. Indexed over
  // the *full* list, so a show keeps its colour when the range narrows.
  const colors = useMemo(
    () => new Map(bands.map((b, i) => [b.id, categoricalColor(i % CATEGORICAL_SLOT_COUNT)])),
    [bands],
  );

  const fullDomain = useMemo<[Date, Date] | null>(
    () => (days.length === 0 ? null : [parseDate(days[0].date), parseDate(days[days.length - 1].date)]),
    [days],
  );

  const points = useMemo<InteractiveAreaPoint[]>(() => {
    const all = days.map((d) => ({ x: parseDate(d.date), values: d.values }));
    if (!range) return all;
    return all.filter((p) => p.x >= range[0] && p.x <= range[1]);
  }, [days, range]);

  // Fixed across ranges so a show keeps its colour while you zoom, but a
  // show with nothing in the window is dropped rather than left in the legend.
  const categories = useMemo<InteractiveAreaCategory[]>(() => {
    const present = new Set(points.flatMap((p) => Object.keys(p.values)));
    return bands.filter((b) => present.has(b.id)).map((b) => ({ ...b, color: colors.get(b.id) }));
  }, [bands, points, colors]);

  return (
    <ChartPage
      title="TV Backlog"
      description="Aired episodes of the shows I follow that I hadn't watched yet, each day, by show."
      info={{
        interactionGuide: AREA_INTERACTION_GUIDE,
        methodology: TV_BACKLOG_METHODOLOGY,
        trackingSpan: TV_BACKLOG_TRACKING_SPAN,
      }}
      filters={
        <>
          {fullDomain ? <TimeRangePicker domain={fullDomain} value={range} onChange={setRange} /> : null}
          <GroupByPicker value={mode} onChange={setMode} options={VIEW_OPTIONS} label="View" className="ml-auto" />
        </>
      }
    >
      <ChartCard empty={days.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={240}>
          {({ width, height }) => (
            <InteractiveArea
              categories={categories}
              points={points}
              width={width}
              height={height}
              mode={mode}
              valueFormat={episodes}
              titleFormat={dayTitle}
              ariaLabel="Unwatched TV episodes of followed shows each day, stacked by show. Hover or focus a band and use arrow keys to inspect it, click a legend entry to hide a show."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
