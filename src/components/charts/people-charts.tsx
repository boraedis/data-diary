"use client";

import { useMemo, useState } from "react";
import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import {
  CompositionExplorer,
  foldToTopCategories,
  OTHER_ID,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import { personImpact } from "@/lib/impact";
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
      for (const person of day.people) totals.set(person.name, (totals.get(person.name) ?? 0) + 1);
    }
    return foldToTopCategories(totals, MAX_PEOPLE);
  }, [data]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      data.map((day) => {
        const values: Record<string, number> = {};
        for (const person of day.people) {
          const id = keep.has(person.name) ? person.name : OTHER_ID;
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

/**
 * Days coloured either by how many people were logged, or by which tagged
 * groups they belonged to.
 *
 * The tag mode is legacy's own (`people_calendar.js`): each person carries
 * their tag's colour, and a day showing several groups renders as their
 * mix, so a year reads as which circles you were moving between rather
 * than as a wall of counts. Legacy achieved it by stacking one translucent
 * rect per person and letting the browser composite them; the primitive
 * now blends perceptually in one fill instead (see
 * `InteractiveCalendarPoint.categories`), which doesn't depend on draw
 * order and doesn't drift toward the background as the count grows.
 *
 * Untagged people are dropped from the mix rather than given a default
 * colour — an invented colour would read as a real group. Their day still
 * appears, coloured by whoever on it *is* tagged, and the tooltip lists
 * only real groups.
 */
type PeopleMode = "count" | "tags";

const MODE_OPTIONS: GroupByOption<PeopleMode>[] = [
  { id: "count", label: "How many" },
  { id: "tags", label: "Groups" },
];

export function PeopleCalendarChart({ data }: { data: PeopleDay[] }) {
  const [mode, setMode] = useState<PeopleMode>("count");

  const points = useMemo(
    () =>
      data.map((day) => {
        if (mode === "count") return { date: day.date, value: day.people.length };
        // One entry per distinct tag on the day, not per person: two
        // people from the same group are one colour in the mix, otherwise
        // a big group would simply dominate every day it appears on.
        const byTag = new Map<string, string>();
        for (const person of day.people) {
          if (person.tagName && person.tagColor) byTag.set(person.tagName, person.tagColor);
        }
        return {
          date: day.date,
          value: day.people.length,
          categories: [...byTag.entries()].map(([label, color]) => ({ label, color })),
        };
      }),
    [data, mode],
  );

  return (
    <CalendarExplorer
      data={points}
      title="People calendar"
      description={
        mode === "count"
          ? "How many people you logged each day. Hover a day for the count."
          : "Which tagged groups you saw each day — a day spanning several groups shows their mix. Hover for the breakdown."
      }
      formatValue={(n) => `${n} ${n === 1 ? "person" : "people"}`}
      valueLabel="people"
      extraFilters={
        <GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="Colour by" />
      }
      ariaLabel={
        mode === "count"
          ? "Calendar heatmap of how many people were logged each day."
          : "Calendar of which tagged groups of people were logged each day, shown as a colour mix."
      }
    />
  );
}

/**
 * How much each person contributed to how your days went, over time.
 *
 * The score is legacy's, ported verbatim — see `src/lib/impact.ts` and
 * #232 for why it stays as-is despite a shape nobody would derive today.
 *
 * **Positive slots only**, for two reasons that happen to agree: the
 * negative branch produces negative scores, which a stacked area can't
 * represent (`InteractiveArea` assumes a zero baseline), and the negative
 * slots hold five appearances in the entire history anyway. Excluding them
 * costs nothing real.
 *
 * Days with no happiness score are skipped rather than scored as zero — the
 * formula is a function of the day's score, so without one there is no
 * impact to compute, and a zero would read as "they were there and it
 * counted for nothing".
 *
 * Weekly by default, per the selection on #209: impact is a week-to-week
 * signal, and monthly buckets flatten exactly the variation worth seeing.
 */
export function PeopleImpactChart({ data }: { data: PeopleDay[] }) {
  const scored = useMemo(
    () => data.filter((day) => day.happiness !== null),
    [data],
  );

  const { categories, keep } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of scored) {
      for (const person of day.people) {
        const score = personImpact(day.happiness as number, person.slot);
        totals.set(person.name, (totals.get(person.name) ?? 0) + score);
      }
    }
    return foldToTopCategories(totals, MAX_PEOPLE);
  }, [scored]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      scored.map((day) => {
        const values: Record<string, number> = {};
        for (const person of day.people) {
          const id = keep.has(person.name) ? person.name : OTHER_ID;
          values[id] = (values[id] ?? 0) + personImpact(day.happiness as number, person.slot);
        }
        return { date: day.date, values };
      }),
    [scored, keep],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={categories}
      title="People impact"
      description="How much each person contributed to how your days went, using the original scoring from the legacy app. Everyone outside the top five is folded into Other."
      valueFormat={(v) => v.toFixed(1)}
      initialPeriod="week"
      ariaLabel="How much each person contributed to how your days went, over time."
    />
  );
}
