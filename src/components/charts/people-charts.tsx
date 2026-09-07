"use client";

import { useMemo } from "react";
import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import {
  CompositionExplorer,
  foldToTopCategories,
  OTHER_ID,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import type { PeopleDay } from "@/lib/charts";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

/**
 * Five names plus "Other".
 *
 * 689 distinct people appear across the history, against a palette with
 * five real slots — so nearly everyone lands in "Other" by construction,
 * and that band is the honest answer rather than a rounding error. The top
 * five are far ahead of the tail (the leader has 862 days, the fifth 520),
 * so the cut is a real one rather than an arbitrary slice through a flat
 * distribution.
 */
const MAX_PEOPLE = 5;

export function PeopleAreaChart({ data }: { data: PeopleDay[] }) {
  const { categories, keep } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of data) {
      for (const name of day.names) totals.set(name, (totals.get(name) ?? 0) + 1);
    }
    return foldToTopCategories(totals, MAX_PEOPLE);
  }, [data]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      data.map((day) => {
        const values: Record<string, number> = {};
        for (const name of day.names) {
          const id = keep.has(name) ? name : OTHER_ID;
          values[id] = (values[id] ?? 0) + 1;
        }
        return { date: day.date, values };
      }),
    [data, keep],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={categories}
      title="Who you saw"
      description="Days logged with each person, as a share of all people logged. Everyone outside the top five is folded into Other."
      valueFormat={(v) => `${Math.round(v)} day${v === 1 ? "" : "s"}`}
      ariaLabel="Who you spent time with over time, as a share of people logged."
    />
  );
}

export function PeopleCalendarChart({ data }: { data: PeopleDay[] }) {
  // How many people were logged that day — not who, which a single
  // sequential colour can't carry anyway. Answers "when were my days full
  // of people and when were they quiet", which is what a calendar of this
  // shape is good for.
  const points = useMemo(
    () => data.map((day) => ({ date: day.date, value: day.names.length })),
    [data],
  );

  return (
    <CalendarExplorer
      data={points}
      title="People calendar"
      description="How many people you logged each day. Hover a day for the count."
      formatValue={(n) => `${n} ${n === 1 ? "person" : "people"}`}
      valueLabel="people"
      ariaLabel="Calendar heatmap of how many people were logged each day."
    />
  );
}
