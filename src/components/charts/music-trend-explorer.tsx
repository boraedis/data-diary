"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveArea,
  type InteractiveAreaCategory,
  type InteractiveAreaMode,
  type InteractiveAreaPoint,
} from "@/components/charts/interactive/interactive-area";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { groupByPeriod, type Period } from "@/lib/viz/bin";
import { parseDate, toDateString } from "@/lib/date";
import { formatDate, formatDuration, formatTitleCase } from "@/lib/viz/format";
import { AREA_TAIL_COLOR } from "@/lib/viz/color";
import { AREA_OTHER_ID } from "@/lib/viz/area-fold";
import type { MusicTrendData, MusicTrendMode } from "@/lib/music-trend";
import { AREA_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { MUSIC_METHODOLOGY } from "@/lib/viz/methodology";
import { MUSIC_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// MusicTrendExplorer (#222) - listening time over time as a stacked area,
// the music counterpart to ExerciseMixExplorer and built the same way: the
// pickers and the chart share state, so one client component owns the whole
// page body. The server hands it month-bucketed hours per band, already
// aggregated in SQL (src/lib/music-trend.ts has the reasoning, including
// why there's no per-genre grouping: tags overlap, so a stack of them
// wouldn't add up to total listening).

const GROUP_OPTIONS: GroupByOption<MusicTrendMode>[] = [
  { id: "artist", label: "Artist" },
  { id: "group", label: "Genre group" },
];

const VIEW_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "stacked", label: "Time" },
  { id: "proportional", label: "% share" },
];

// The data is month-bucketed, so a week view would just be the month view
// with wider gaps; the finer grain doesn't exist to show.
const PERIODS: Period[] = ["month", "quarter", "year"];

// Appended to the shared music methodology: this chart's one departure from
// "what you'd expect", and the reason it exists as a separate view from the
// leaderboard's genres.
const GENRE_NOTE =
  " In the genre-group view, an artist in more than one group has each listen split evenly between them, so the bands always add up to total listening — unlike the Music Leaderboard, which credits a listen in full to every genre. Artists whose genres aren't in any group share one \"No group\" band. In the artist view, the 99 most-listened artists get their own bands and everyone else is folded into Other. Podcasts aren't included, and months follow UTC.";

function titleFormatterFor(period: Period): (x: Date) => string {
  switch (period) {
    case "quarter":
      return (x) => `Q${Math.floor(x.getMonth() / 3) + 1} ${x.getFullYear()}`;
    case "year":
      return (x) => String(x.getFullYear());
    default:
      return (x) => formatDate(toDateString(x), "monthYear");
  }
}

export function MusicTrendExplorer({ artist, group }: { artist: MusicTrendData; group: MusicTrendData }) {
  const [mode, setMode] = useState<InteractiveAreaMode>("stacked");
  const [period, setPeriod] = useState<Period>("quarter");
  const [groupBy, setGroupBy] = useState<MusicTrendMode>("group");
  const [range, setRange] = useState<[Date, Date] | null>(null);

  const data = groupBy === "artist" ? artist : group;

  // Rows arrive oldest-first from the query, in either grouping.
  const fullDomain = useMemo<[Date, Date] | null>(() => {
    if (data.rows.length === 0) return null;
    return [parseDate(data.rows[0].date), parseDate(data.rows[data.rows.length - 1].date)];
  }, [data.rows]);

  const rows = useMemo(() => {
    if (!range) return data.rows;
    const [start, end] = range;
    return data.rows.filter((r) => {
      const d = parseDate(r.date);
      return d >= start && d <= end;
    });
  }, [data.rows, range]);

  // Bands stay fixed across periods and ranges (so colours don't shuffle as
  // you zoom) but ones with no listening in the window are dropped, not left
  // as zero-height bands cluttering the legend.
  const categories = useMemo<InteractiveAreaCategory[]>(() => {
    const present = new Set(rows.map((r) => r.id));
    return data.bands
      .filter((b) => present.has(b.id))
      .map((b) => ({
        id: b.id,
        label: groupBy === "artist" ? b.label : formatTitleCase(b.label),
        color: b.id === AREA_OTHER_ID ? AREA_TAIL_COLOR : (b.color ?? undefined),
      }));
  }, [data.bands, rows, groupBy]);

  const points = useMemo<InteractiveAreaPoint[]>(
    () =>
      groupByPeriod(rows, period, (r) => r.date).map(({ start, items }) => {
        const values: Record<string, number> = {};
        for (const r of items) values[r.id] = (values[r.id] ?? 0) + r.hours;
        return { x: parseDate(start), values };
      }),
    [rows, period],
  );
  const titleFormat = useMemo(() => titleFormatterFor(period), [period]);

  return (
    <ChartPage
      title="Music Trend"
      description="Time spent listening to music, by artist or genre group, aggregated by period."
      info={{
        interactionGuide: AREA_INTERACTION_GUIDE,
        methodology: MUSIC_METHODOLOGY + GENRE_NOTE,
        trackingSpan: MUSIC_TRACKING_SPAN,
      }}
      filters={
        <>
          <PeriodPicker value={period} onChange={setPeriod} periods={PERIODS} />
          {fullDomain ? <TimeRangePicker domain={fullDomain} value={range} onChange={setRange} /> : null}
          <GroupByPicker value={groupBy} onChange={setGroupBy} options={GROUP_OPTIONS} label="Group by" />
          <GroupByPicker value={mode} onChange={setMode} options={VIEW_OPTIONS} label="View" className="ml-auto" />
        </>
      }
    >
      <ChartCard empty={data.rows.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={240}>
          {({ width, height }) => (
            <InteractiveArea
              categories={categories}
              points={points}
              width={width}
              height={height}
              mode={mode}
              valueFormat={formatDuration}
              titleFormat={titleFormat}
              ariaLabel="Time spent listening to music over time, broken down by artist or genre group. Hover or focus a band and use arrow keys to inspect it, click a legend entry to hide a band."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
