"use client";

import { useCallback, useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import {
  InteractiveRanked,
  RankMovementCell,
  type RankedColumn,
  type RankedEntry,
} from "@/components/charts/interactive/interactive-ranked";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import {
  CompositionExplorer,
  foldToTopCategories,
  OTHER_ID,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import { personImpact, recencyWeight } from "@/lib/impact";
import { computeRankings, type RankWindow } from "@/lib/ranking";
import { categoricalColor } from "@/lib/viz/color";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveBarRace } from "@/components/charts/interactive/interactive-bar-race";
import type { RaceFrame } from "@/lib/viz/race";
import { daysBetween, parseDate } from "@/lib/date";
import type { PeopleDay } from "@/lib/charts";
import { BAR_RACE_INTERACTION_GUIDE, RANKED_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";

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

/**
 * The people table: everyone ranked by days logged, with how their standing
 * has moved lately.
 *
 * Legacy's `people_table` showed trailing *counts* for week/month/year;
 * this shows the count and the **rank movement** alongside it, which is
 * what the counts were really being read for. See `src/lib/ranking.ts` for
 * the definition — each window is a *point in time*, so the week column
 * asks where someone stood a week ago and compares it with now. Both sides
 * are all-time standings; only the moment differs, which is what keeps the
 * movement column consistent with the total it sits beside.
 *
 * Anchored on the latest logged day rather than today: a gap in logging
 * would otherwise empty the recent windows and report everyone as having
 * vanished at once.
 */
const RANK_WINDOWS: RankWindow[] = [
  { id: "week", label: "Week", days: 7 },
  { id: "month", label: "Month", days: 31 },
  { id: "year", label: "Year", days: 365 },
];

export function PeopleTableChart({ data }: { data: PeopleDay[] }) {
  const [limit, setLimit] = useState<TableLimit>("50");

  const { entries, byName } = useMemo(() => {
    const appearances = data.flatMap((day) =>
      day.people.map((person) => ({ key: person.name, date: day.date })),
    );
    const asOf = data.length > 0 ? data[data.length - 1].date : "";
    const ranked = asOf ? computeRankings(appearances, asOf, RANK_WINDOWS) : [];

    // Latest tag wins where someone has been retagged — the table is a
    // "who are they now" view, not a history of their tagging. The colour
    // travels with the tag from the data rather than being assigned here,
    // so it matches the people calendar's groups mode.
    const tags = new Map<string, { name: string | null; color: string | null }>();
    for (const day of data) {
      for (const person of day.people) {
        tags.set(person.name, { name: person.tagName, color: person.tagColor });
      }
    }

    return {
      entries: ranked.map((item) => ({ label: item.key, value: item.total })),
      byName: new Map(
        ranked.map((item) => [
          item.key,
          { item, tag: tags.get(item.key) ?? { name: null, color: null } },
        ]),
      ),
    };
  }, [data]);

  const shown = useMemo(
    () => (limit === "all" ? entries : entries.slice(0, Number(limit))),
    [entries, limit],
  );

  const columns = useMemo<RankedColumn[]>(
    () =>
      RANK_WINDOWS.map((window) => ({
        id: window.id,
        label: window.label,
        // Week stays on a phone; month and year are the first to go.
        secondary: window.id !== "week",
        render: (entry: RankedEntry) => {
          const found = byName.get(entry.label);
          if (!found) return null;
          const movement = found.item.movements[window.id];
          return (
            <span className="flex items-baseline justify-end gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {found.item.counts[window.id]}
              </span>
              <RankMovementCell delta={movement.delta} isNew={movement.isNew} />
            </span>
          );
        },
      })),
    [byName],
  );

  return (
    <ChartPage
      title="People table"
      description="Everyone ranked by days logged. Each window shows days gained in that period and how the overall ranking has moved since then."
      info={{ interactionGuide: RANKED_INTERACTION_GUIDE }}
      filters={
        <GroupByPicker value={limit} onChange={setLimit} options={LIMIT_OPTIONS} label="Show" />
      }
    >
      <ChartCard empty={shown.length === 0}>
        <InteractiveRanked
          entries={shown}
          valueLabel="Days"
          detail={(entry) => byName.get(entry.label)?.tag.name ?? null}
          columns={columns}
          color={(entry) => byName.get(entry.label)?.tag.color ?? categoricalColor(0)}
          ariaLabel="People ranked by days logged, with how their ranking has moved since a week, a month and a year ago."
        />
      </ChartCard>
    </ChartPage>
  );
}

type TableLimit = "25" | "50" | "all";

const LIMIT_OPTIONS: GroupByOption<TableLimit>[] = [
  { id: "25", label: "Top 25" },
  { id: "50", label: "Top 50" },
  { id: "all", label: "Everyone" },
];

/**
 * The people bar race: who mattered most, week by week.
 *
 * Legacy had this chart (`people_bar_race.js`) and it's the reason #103
 * exists. The scoring is legacy's, in full: each day a person appears
 * contributes `personImpact(day's happiness, their slot)`, and every past
 * day is then weighted by `recencyWeight(how long ago it was)` — an arctan
 * fade with a floor, not a decaying-to-nothing exponential. So a frame's
 * value is not a running total but a **recency-weighted standing at that
 * moment**, which is what makes the race a race: bars fall as well as
 * rise, and someone who drops out of your life slides back down the board
 * over the following year or two instead of sitting on an unassailable
 * lifetime score. See `src/lib/impact.ts` for both curves and why neither
 * gets "fixed".
 *
 * Deliberate departures from legacy, all of them things it got wrong
 * rather than choices it made:
 *  - Days with no happiness score are skipped, not scored as zero (the
 *    same call `PeopleImpactChart` makes above — without a score there is
 *    no impact to compute, and a zero would read as "they were there and
 *    it counted for nothing"). Legacy passed `undefined` into the formula
 *    and summed the resulting NaN.
 *  - Negative slots are excluded, again matching `PeopleImpactChart`:
 *    `getPeopleDailyData` doesn't return them, they hold five appearances
 *    in the whole history, and a bar race can't draw a negative bar
 *    anyway. Legacy tried to read them and indexed its own slot-weight
 *    table out of bounds doing it.
 *
 * The whole thing is computed here on the client, not in SQL: the impact
 * curve is TypeScript, the same rows already feed three other charts on
 * this page, and the work is a few million multiply-adds done once per
 * mount rather than per frame — playback itself reads the finished frames.
 */

/** One frame a week, matching legacy's `i % 7 == 0`. Weekly is what makes
 * a decade legible in a minute of playback; daily frames would be 3,000 of
 * them and no more informative, since the fader moves slowly by design. */
const RACE_FRAME_INTERVAL_DAYS = 7;

/** Legacy dropped the first 100 days (`day > START + 100`). Kept: the
 * opening weeks are a handful of days against a nearly empty board, so the
 * race starts with wild rank churn that means nothing. */
const RACE_WARM_UP_DAYS = 100;

/** Legacy's `sum > 5`. Someone logged a handful of times can't hold a
 * position on the board, but they can flicker through it on the day they
 * appear; the cut keeps the race about the people actually in your life. */
const RACE_MIN_DAYS_LOGGED = 6;

/** Bars on screen at once — legacy's own range (it used 20-25 on a fixed
 * 800px-tall canvas). A race is more interesting the deeper the board
 * goes, since the movement worth watching is mostly outside the top few;
 * this is what the taller chart height below buys. */
const RACE_TOP_N = 20;

/** Impact scores are unitless — whole numbers read better racing than
 * `PeopleImpactChart`'s one decimal, which nobody can track at 3 frames a
 * second. Module-level so its identity is stable across renders. */
const formatImpactScore = (value: number) => Math.round(value).toLocaleString();

export function PeopleRaceChart({ data }: { data: PeopleDay[] }) {
  const { frames, colorByName } = useMemo(() => {
    const scored = data.filter((day) => day.happiness !== null);
    if (scored.length === 0) return { frames: [] as RaceFrame[], colorByName: new Map<string, string>() };

    // Who's eligible, and what colour they carry. Latest tag wins, same as
    // the people table's own "who are they now" reading.
    const appearances = new Map<string, number>();
    const colorByName = new Map<string, string>();
    for (const day of scored) {
      for (const person of day.people) {
        appearances.set(person.name, (appearances.get(person.name) ?? 0) + 1);
        if (person.tagColor) colorByName.set(person.name, person.tagColor);
      }
    }
    const eligible = new Set(
      [...appearances.entries()].filter(([, n]) => n >= RACE_MIN_DAYS_LOGGED).map(([name]) => name),
    );

    // Flattened once up front: the frame loop below walks this list for
    // every frame, so it must not be re-deriving day shapes as it goes.
    const start = scored[0].date;
    const contributions = scored.map((day) => ({
      date: day.date,
      dayIndex: daysBetween(start, day.date),
      scores: day.people
        .filter((person) => eligible.has(person.name))
        .map((person) => ({
          name: person.name,
          score: personImpact(day.happiness as number, person.slot),
        })),
    }));

    const frames: RaceFrame[] = [];
    let nextFrameIndex = RACE_WARM_UP_DAYS;
    for (const day of contributions) {
      if (day.dayIndex < nextFrameIndex) continue;
      // Anchored to logged days rather than to the calendar, so a gap in
      // logging skips frames instead of emitting a run of identical ones.
      nextFrameIndex = day.dayIndex + RACE_FRAME_INTERVAL_DAYS;

      const totals = new Map<string, number>();
      for (const past of contributions) {
        if (past.dayIndex > day.dayIndex) break;
        const weight = recencyWeight(day.dayIndex - past.dayIndex);
        for (const { name, score } of past.scores) {
          totals.set(name, (totals.get(name) ?? 0) + weight * score);
        }
      }

      frames.push({
        date: parseDate(day.date),
        entries: [...totals.entries()]
          // A negative standing is possible in principle (the impact curve
          // can go negative) and can't be drawn as a bar; dropping those
          // rows is honest here because in this data set it never happens
          // — negative slots aren't in the source at all.
          .filter(([, value]) => value > 0)
          .map(([label, value]) => ({ label, value })),
      });
    }

    return { frames, colorByName };
  }, [data]);

  const color = useCallback(
    (label: string) => colorByName.get(label) ?? categoricalColor(0),
    [colorByName],
  );

  return (
    <ChartPage
      title="People race"
      description="Who mattered most, week by week — each person's score sums the impact of every day you logged them, with older days fading, so the board reflects who was around lately rather than an all-time total."
      info={{ interactionGuide: BAR_RACE_INTERACTION_GUIDE }}
      filters={null}
    >
      <ChartCard empty={frames.length === 0}>
        {/* Used to be taller than the app's shared chart-height class, back
            when that class was capped well short of the viewport — 20 rows
            carrying a name and a number inside each bar wanted more room
            than a line or calendar chart typically needs. #315 made the
            shared class fill the remaining viewport height by default, so
            this is no longer a special case. */}
        <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
          {({ width, height }) => (
            <InteractiveBarRace
              frames={frames}
              topN={RACE_TOP_N}
              width={width}
              height={height}
              color={color}
              formatValue={formatImpactScore}
              ariaLabel="Animated ranking of the people in your days, scored by recency-weighted impact, from the start of the log to the most recent week."
            />
          )}
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
