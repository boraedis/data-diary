"use client";

import { useMemo } from "react";
import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import { Legend } from "@/components/charts/interactive/legend";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue, DayTypeDay } from "@/lib/charts";
import { DAY_TYPE_METHODOLOGY, HAPPINESS_METHODOLOGY } from "@/lib/viz/methodology";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

export function HappinessCalendarChart({ data }: { data: DailyValue[] }) {
  return (
    <CalendarExplorer
      data={data}
      title="Happiness Calendar"
      description="Every logged day's happiness score. Hover a day for the exact value."
      methodology={HAPPINESS_METHODOLOGY}
      formatValue={(v) => `${Math.round(v)} / 100`}
      valueLabel="happiness"
      ariaLabel="Calendar heatmap of daily happiness scores."
    />
  );
}

/**
 * Day types, ordered by how often they occur.
 *
 * Order matters because it decides colour: `categoricalColor` has five real
 * slots before it flattens to one muted grey for everything beyond, and
 * there are six day types. Ranking by frequency means the grey lands on the
 * rarest — `sick`, five days in the whole history — rather than on
 * something you'd actually want to pick out of the grid.
 *
 * Fixed rather than derived from the data so a type's colour doesn't shift
 * when the visible range changes.
 */
const DAY_TYPE_ORDER = ["work", "dayoff", "vacation", "travel", "jobless", "sick"] as const;

const DAY_TYPE_LABELS: Record<string, string> = {
  work: "Work",
  dayoff: "Day off",
  vacation: "Vacation",
  travel: "Travel",
  jobless: "Jobless",
  sick: "Sick",
};

function dayTypeColor(dayType: string): string {
  const index = DAY_TYPE_ORDER.indexOf(dayType as (typeof DAY_TYPE_ORDER)[number]);
  return categoricalColor(index === -1 ? DAY_TYPE_ORDER.length : index);
}

/**
 * A categorical calendar: each cell is the colour of that day's type.
 *
 * Rides on the same `categories` mechanism the tag-blending mode uses, with
 * exactly one category per day — a "blend" of one colour is that colour. So
 * this needed no new capability beyond #210, which is a good sign the
 * primitive's shape is right.
 *
 * The primitive suppresses its sequential legend in that mode (a low-to-high
 * ramp would describe an encoding these cells aren't using), so the key is
 * rendered here instead.
 */
export function DayTypeCalendarChart({ data }: { data: DayTypeDay[] }) {
  const points = useMemo(
    () =>
      data.map((day) => ({
        date: day.date,
        // A constant, deliberately. The primitive scales a blended cell's
        // intensity by its value so a calendar keeps saying "how much"
        // alongside "which kinds" — but a day has exactly one type, so
        // there is no magnitude here to show. Passing anything varying
        // (a slot index, say) would make `work` and `sick` differ in
        // strength for no reason a reader could interpret. Equal values
        // render every day at full intensity.
        value: 1,
        categories: [
          { label: DAY_TYPE_LABELS[day.dayType] ?? day.dayType, color: dayTypeColor(day.dayType) },
        ],
      })),
    [data],
  );

  const present = useMemo(() => {
    const seen = new Set(data.map((d) => d.dayType));
    return DAY_TYPE_ORDER.filter((t) => seen.has(t));
  }, [data]);

  return (
    <CalendarExplorer
      data={points}
      title="Day Types Calendar"
      description="How each day was classified. Days with no type set are left blank."
      methodology={DAY_TYPE_METHODOLOGY}
      formatValue={() => ""}
      valueLabel=""
      extraFilters={
        <Legend
          series={present.map((t) => ({
            id: t,
            label: DAY_TYPE_LABELS[t],
            color: dayTypeColor(t),
          }))}
        />
      }
      ariaLabel="Calendar of how each day was classified — work, day off, vacation and so on."
    />
  );
}
