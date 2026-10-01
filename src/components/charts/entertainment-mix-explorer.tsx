"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveArea, type InteractiveAreaCategory, type InteractiveAreaMode } from "@/components/charts/interactive/interactive-area";
import { PeriodPicker } from "@/components/charts/interactive/period-picker";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import type { Period } from "@/lib/viz/bin";
import { parseDate, toDateString } from "@/lib/date";
import { formatDate, formatDuration } from "@/lib/viz/format";
import { AREA_TAIL_COLOR } from "@/lib/viz/color";
import { buildEntertainmentMixPoints } from "@/lib/viz/entertainment-mix";
import {
  ENTERTAINMENT_TYPE_LABELS,
  ENTERTAINMENT_TYPE_ORDER,
  entertainmentTypeColor,
} from "@/lib/entertainment-types";
import type { EntertainmentDay } from "@/lib/charts";
import { AREA_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { ENTERTAINMENT_METHODOLOGY } from "@/lib/viz/methodology";
import { ENTERTAINMENT_TREND_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// Entertainment Mix (#222) — what share of entertainment time went to each
// medium, stacked over time. The companion to Entertainment Trend (#479),
// which draws the same daily series as lines and said this stacked view
// belonged here. Bands are fixed, in the leaderboard's colour-slot order
// ("Other" takes the muted tail colour, not a sixth hue), and always sum to
// total time because a session belongs to exactly one medium. Values are
// average hours per day — see buildEntertainmentMixPoints.

const CATEGORIES: InteractiveAreaCategory[] = ENTERTAINMENT_TYPE_ORDER.map((type) => ({
  id: type,
  label: ENTERTAINMENT_TYPE_LABELS[type],
  color: entertainmentTypeColor(type) ?? AREA_TAIL_COLOR,
}));

const VIEW_OPTIONS: GroupByOption<InteractiveAreaMode>[] = [
  { id: "stacked", label: "Time" },
  { id: "proportional", label: "% share" },
];

const perDay = (hours: number) => `${formatDuration(hours)}/day`;

function titleFormatterFor(period: Period): (x: Date) => string {
  switch (period) {
    case "week":
      return (x) => `Week of ${formatDate(toDateString(x), "short")}`;
    case "month":
      return (x) => formatDate(toDateString(x), "monthYear");
    case "quarter":
      return (x) => `Q${Math.floor(x.getMonth() / 3) + 1} ${x.getFullYear()}`;
    case "year":
      return (x) => String(x.getFullYear());
  }
}

export function EntertainmentMixExplorer({ data }: { data: EntertainmentDay[] }) {
  const [mode, setMode] = useState<InteractiveAreaMode>("stacked");
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<[Date, Date] | null>(null);

  // Zero-filled and oldest-first, so the ends are the extent.
  const fullDomain = useMemo<[Date, Date] | null>(
    () => (data.length === 0 ? null : [parseDate(data[0].date), parseDate(data[data.length - 1].date)]),
    [data],
  );

  const days = useMemo(() => {
    if (!range) return data;
    const [start, end] = range;
    return data.filter((d) => {
      const x = parseDate(d.date);
      return x >= start && x <= end;
    });
  }, [data, range]);

  const points = useMemo(() => buildEntertainmentMixPoints(days, period), [days, period]);
  const titleFormat = useMemo(() => titleFormatterFor(period), [period]);

  return (
    <ChartPage
      title="Entertainment Mix"
      description="Average daily time on each kind of entertainment, stacked, aggregated by period."
      info={{
        interactionGuide: AREA_INTERACTION_GUIDE,
        methodology: ENTERTAINMENT_METHODOLOGY,
        trackingSpan: ENTERTAINMENT_TREND_TRACKING_SPAN,
      }}
      filters={
        <>
          <PeriodPicker value={period} onChange={setPeriod} />
          {fullDomain ? <TimeRangePicker domain={fullDomain} value={range} onChange={setRange} /> : null}
          <GroupByPicker value={mode} onChange={setMode} options={VIEW_OPTIONS} label="View" className="ml-auto" />
        </>
      }
    >
      <ChartCard empty={data.length === 0}>
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={240}>
          {({ width, height }) => (
            <InteractiveArea
              categories={CATEGORIES}
              points={points}
              width={width}
              height={height}
              mode={mode}
              valueFormat={perDay}
              titleFormat={titleFormat}
              ariaLabel="Average daily time on each kind of entertainment over time. Hover or focus a band and use arrow keys to inspect it, click a legend entry to hide a medium."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
