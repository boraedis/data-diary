"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { InteractiveLine, type InteractiveLineSeries } from "@/components/charts/interactive/interactive-line";
import { Legend, SeriesKey } from "@/components/charts/interactive/legend";
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { addDays, daysBetween, parseDate, toDateString } from "@/lib/date";
import {
  buildImpactTimeline,
  IMPACT_TREND_TOP_N,
  IMPACT_TREND_WARM_UP_DAYS,
  dailyStandings,
  impactTrendTags,
  resolveSelection,
  type ImpactTimeline,
  type ImpactTrendSelection,
  type ShownPerson,
} from "@/lib/people-impact-trend";
import type { PeopleDay } from "@/lib/charts";
import { categoricalColor } from "@/lib/viz/color";
import { formatThousandsNumber } from "@/lib/viz/format";
import { LINE_SERIES_HOVER_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PEOPLE_IMPACT_TREND_METHODOLOGY } from "@/lib/viz/methodology";
import { PEOPLE_TRACKING_SPAN } from "@/lib/viz/tracking-span";
import { cn } from "@/lib/utils";

// People Impact Trend — legacy's `people_impact_averager.js`: one line per
// person, their recency-weighted impact standing on every day, over a
// roster the reader builds. It replaced a five-names-plus-Other stacked
// area of day counts, which could only ever show the same five people and
// said nothing about impact. The scoring and the roster rules live in
// src/lib/people-impact-trend.ts; this file is the controls and the chart.
//
// The time range picker is a **view**, not a filter (#441): it sets which
// dates the axes show — the y-axis fits the visible stretch, so narrowing
// the range zooms both axes — but who's on the chart, and every colour,
// is decided over the whole history and never changes as it's dragged.
//
// Two things here are deliberate departures from how other line charts in
// this app are put together, both forced by the line count (thirty by
// default, sixty and up once tags are added):
//
// - **Hover picks a line** (`hover="series"`), since a crosshair tooltip
//   listing every line at one date would be a sixty-row list.
// - **No built-in legend.** A toggle row per person would outgrow the plot.
//   The roster below the controls names everyone shown, and is where people
//   are dropped; the legend above the chart keys only the colours.

type ColorBy = "tag" | "picked";

const PRESET_OPTIONS: GroupByOption<ImpactTrendSelection["preset"]>[] = [
  { id: "impact", label: `Top ${IMPACT_TREND_TOP_N} impact` },
  { id: "logged", label: `Top ${IMPACT_TREND_TOP_N} logged` },
  { id: "none", label: "Nobody" },
];

/**
 * - "tag": each person in their tag's own colour — the colours are the
 *   user's, chosen per group, so a group view reads as its colour without a
 *   key. Legacy's "Tag Colors" switch.
 * - "picked": the first five people added by name get the categorical
 *   slots, in the order they were added (so a later pick doesn't repaint
 *   an earlier one). Everyone else — later picks, and whoever a preset or
 *   tag brought in — gets a colour of their own derived from their name
 *   (`nameColor`), rather than the grey `categoricalColor` falls back to.
 *   That breaks this app's five-slots-then-grey rule on purpose, at the
 *   user's request on #441: a grey mass of thirty lines hid who was who,
 *   and hover alone was too slow a way to tell them apart. Colours can
 *   repeat or sit close together at this line count; hover is still the
 *   way to be sure.
 */
const COLOR_OPTIONS: GroupByOption<ColorBy>[] = [
  { id: "tag", label: "Group" },
  { id: "picked", label: "Picked" },
];

/** The neutral for untagged people in "tag" colouring — the same one
 * `categoricalColor` falls back to. */
const CONTEXT_COLOR = "var(--muted-foreground)";

/** Real categorical slots — mirrors `CATEGORICAL_SLOT_COUNT` in
 * src/lib/viz/color.ts, past which `categoricalColor` returns grey. */
const PICK_SLOTS = 5;

/**
 * A colour for a person, derived from their name: random-looking, but the
 * same on every load and unaffected by who else is on the chart, so adding
 * someone never repaints anyone already there. The hue comes from an
 * FNV-1a hash of the name; lightness and chroma are fixed in oklch so every
 * line carries the same visual weight, and sit mid-range so they read on
 * both the light and dark card.
 */
function nameColor(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `oklch(0.7 0.14 ${(hash >>> 0) % 360})`;
}

const DEFAULT_SELECTION: ImpactTrendSelection = { preset: "impact", tags: [], people: [], excluded: [] };

/** Standings run into the hundreds, where a decimal is noise. */
const formatStanding = (value: number) => formatThousandsNumber(Math.round(value));

const PAGE = {
  title: "People Impact Trend",
  description:
    "How much each person mattered in my days over time. Start from the top thirty, add whole groups or anyone by name, and drop anyone you don't want.",
  info: {
    interactionGuide: LINE_SERIES_HOVER_INTERACTION_GUIDE,
    methodology: PEOPLE_IMPACT_TREND_METHODOLOGY,
    trackingSpan: PEOPLE_TRACKING_SPAN,
  },
};

export function PeopleImpactTrendChart({
  data,
  nicknames,
}: {
  data: PeopleDay[];
  nicknames: Record<string, string[]>;
}) {
  const timeline = useMemo(() => buildImpactTimeline(data), [data]);
  if (!timeline) {
    return (
      <ChartPage {...PAGE} filters={null}>
        <ChartCard empty>{null}</ChartCard>
      </ChartPage>
    );
  }
  return <ImpactTrendExplorer timeline={timeline} nicknames={nicknames} />;
}

/** Split out so `timeline` is non-null everywhere below. Owns the whole
 * page shell, like /charts/weight: the filters row and the chart share
 * state. */
function ImpactTrendExplorer({
  timeline,
  nicknames,
}: {
  timeline: ImpactTimeline;
  nicknames: Record<string, string[]>;
}) {
  const [range, setRange] = useState<[Date, Date] | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("tag");
  const [selection, setSelection] = useState<ImpactTrendSelection>(DEFAULT_SELECTION);
  const [rosterOpen, setRosterOpen] = useState(false);

  const warmUp = Math.min(IMPACT_TREND_WARM_UP_DAYS, timeline.lastDay);
  const domain = useMemo<[Date, Date]>(
    () => [parseDate(addDays(timeline.start, warmUp)), parseDate(timeline.end)],
    [timeline, warmUp],
  );
  // The picked range as day indices, clamped to the history so an edge
  // the picker rounds past it can't index outside the prefix sums.
  const s = range ? Math.max(warmUp, daysBetween(timeline.start, toDateString(range[0]))) : warmUp;
  const e = range ? Math.min(timeline.lastDay, daysBetween(timeline.start, toDateString(range[1]))) : timeline.lastDay;

  // Independent of the range on purpose — see the header.
  const shown = useMemo(() => resolveSelection(timeline, selection), [timeline, selection]);

  // One Date per day index, built once: a daily line per person means tens
  // of thousands of points, and each would otherwise construct its own.
  const dayDates = useMemo(
    () => Array.from({ length: timeline.lastDay + 1 }, (_, i) => parseDate(addDays(timeline.start, i))),
    [timeline],
  );

  const colorOf = useMemo(() => {
    const slots = new Map(selection.people.map((name, i) => [name, i]));
    return (name: string) => {
      if (colorBy === "tag") return timeline.byName.get(name)?.tagColor ?? CONTEXT_COLOR;
      const slot = slots.get(name);
      return slot !== undefined && slot < PICK_SLOTS ? categoricalColor(slot) : nameColor(name);
    };
  }, [colorBy, selection.people, timeline]);

  // Each line is cut to the visible range here rather than left to the
  // x-axis: InteractiveLine doesn't clip its paths to the plot, so points
  // outside the domain would draw across the margins. Days before someone's
  // first appearance (standing exactly 0) are left off, so a line starts
  // where they entered the log instead of running along zero until then.
  const series = useMemo<InteractiveLineSeries[]>(() => {
    const picked = new Set(selection.people);
    return shown
      .map(({ name }) => {
        const standings = dailyStandings(timeline, name);
        const points = [];
        for (let i = s; i <= e; i++) {
          if (standings[i] > 0) points.push({ x: dayDates[i], y: standings[i] });
        }
        return { id: name, label: name, color: colorOf(name), points };
      })
      // Hand-picked people last, so they draw over everyone else.
      .sort((a, b) => Number(picked.has(a.id)) - Number(picked.has(b.id)));
  }, [shown, timeline, s, e, dayDates, colorOf, selection.people]);

  // Fitted to what's visible, so narrowing the range zooms the y-axis too.
  // Clamped at zero rather than left to InteractiveLine's auto-domain, whose
  // padding can dip below it — a standing is never negative (positive slots
  // only), so space under zero would be plot spent on nothing.
  const yDomain = useMemo<[number, number]>(() => {
    let min = Infinity;
    let max = 0;
    for (const line of series) {
      for (const p of line.points) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
    }
    if (max === 0) return [0, 1];
    const pad = (max - min) * 0.05 || max * 0.05;
    return [Math.max(0, min - pad), max + pad];
  }, [series]);

  const legend = useMemo(() => {
    if (colorBy === "tag") {
      const tags = new Map<string, string>();
      let untagged = false;
      for (const { name } of shown) {
        const person = timeline.byName.get(name);
        if (person?.tagName) tags.set(person.tagName, person.tagColor ?? CONTEXT_COLOR);
        else untagged = true;
      }
      const rows = [...tags.entries()].map(([label, color]) => ({ label, color }));
      if (untagged) rows.push({ label: "No group", color: CONTEXT_COLOR });
      return rows;
    }
    // Only the picks: everyone else has a colour of their own now, and a
    // thirty-row key would outgrow the chart. Hover names the rest.
    return selection.people
      .filter((name) => shown.some((p) => p.name === name))
      .map((name) => ({ label: name, color: colorOf(name) }));
  }, [colorBy, shown, timeline, selection.people, colorOf]);

  // --- Roster edits --------------------------------------------------------
  // Adding someone (or their whole group) always wins over an earlier drop:
  // it's the more recent, more specific instruction.
  const addPerson = (name: string) =>
    setSelection((cur) => ({
      ...cur,
      people: cur.people.includes(name) ? cur.people : [...cur.people, name],
      excluded: cur.excluded.filter((n) => n !== name),
    }));
  const addTag = (tag: string) =>
    setSelection((cur) => ({
      ...cur,
      tags: cur.tags.includes(tag) ? cur.tags : [...cur.tags, tag],
      excluded: cur.excluded.filter((n) => timeline.byName.get(n)?.tagName !== tag),
    }));
  const removeTag = (tag: string) => setSelection((cur) => ({ ...cur, tags: cur.tags.filter((t) => t !== tag) }));
  const unpick = (name: string) => setSelection((cur) => ({ ...cur, people: cur.people.filter((n) => n !== name) }));
  // Dropping from the roster removes a pick *and* excludes them, so a tag
  // or the preset doesn't quietly bring them straight back.
  const drop = (name: string) =>
    setSelection((cur) => ({
      ...cur,
      people: cur.people.filter((n) => n !== name),
      excluded: cur.excluded.includes(name) ? cur.excluded : [...cur.excluded, name],
    }));
  const restore = (name: string) =>
    setSelection((cur) => ({ ...cur, excluded: cur.excluded.filter((n) => n !== name) }));

  const isDefault =
    selection.preset === DEFAULT_SELECTION.preset &&
    selection.tags.length === 0 &&
    selection.people.length === 0 &&
    selection.excluded.length === 0;

  const tagColors = useMemo(
    () => new Map(impactTrendTags(timeline).map((t) => [t.name, t.color ?? CONTEXT_COLOR])),
    [timeline],
  );

  const filters = (
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <PeopleSearch
            timeline={timeline}
            nicknames={nicknames}
            shown={shown}
            selectedTags={selection.tags}
            onAddPerson={addPerson}
            onAddTag={addTag}
          />
          <GroupByPicker
            value={selection.preset}
            onChange={(preset) => setSelection((cur) => ({ ...cur, preset }))}
            options={PRESET_OPTIONS}
            label="Start with"
          />
          <GroupByPicker value={colorBy} onChange={setColorBy} options={COLOR_OPTIONS} label="Colour by" />
          <TimeRangePicker domain={domain} value={range} onChange={setRange} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {selection.tags.map((tag) => (
            <Chip
              key={`tag:${tag}`}
              color={tagColors.get(tag) ?? CONTEXT_COLOR}
              label={tag}
              detail="group"
              removeLabel={`Remove the ${tag} group`}
              onRemove={() => removeTag(tag)}
            />
          ))}
          {selection.people.map((name) => (
            <Chip
              key={`person:${name}`}
              color={colorOf(name)}
              label={name}
              removeLabel={`Remove ${name}`}
              onRemove={() => unpick(name)}
            />
          ))}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-expanded={rosterOpen}
            onClick={() => setRosterOpen((open) => !open)}
          >
            {shown.length} {shown.length === 1 ? "person" : "people"} shown
            {selection.excluded.length > 0 ? ` · ${selection.excluded.length} dropped` : ""}
            <span aria-hidden>{rosterOpen ? "▴" : "▾"}</span>
          </Button>
          {isDefault ? null : (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                setSelection(DEFAULT_SELECTION);
                setRosterOpen(false);
              }}
            >
              Reset
            </Button>
          )}
        </div>

        {rosterOpen ? (
          <Roster
            shown={shown}
            excluded={selection.excluded}
            colorOf={colorOf}
            onDrop={drop}
            onRestore={restore}
          />
        ) : null}
      </div>
  );

  return (
    <ChartPage {...PAGE} filters={filters}>
      <ChartCard>
        {series.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nobody selected. Pick a starting set above, or search for a person or group to add.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Legend series={legend} />
            <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport>
              {({ width, height }) => (
                <InteractiveLine
                  series={series}
                  width={width}
                  height={height}
                  xDomain={[parseDate(addDays(timeline.start, s)), parseDate(addDays(timeline.start, e))]}
                  yDomain={yDomain}
                  hover="series"
                  showLegend={false}
                  yTickFormat={(v) => formatThousandsNumber(Number(v))}
                  valueFormat={formatStanding}
                  dateFormat="dayYear"
                  ariaLabel="Each selected person's recency-weighted impact over time, one line per person. Use left and right arrows to move through time and up and down to move between people."
                />
              )}
            </ResponsiveChart>
          </div>
        )}
      </ChartCard>
    </ChartPage>
  );
}

function Chip({
  color,
  label,
  detail,
  removeLabel,
  onRemove,
  muted,
}: {
  color: string;
  label: string;
  detail?: string;
  removeLabel: string;
  onRemove: () => void;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-foreground/10 pr-1 pl-2.5 text-xs",
        muted ? "text-muted-foreground" : "bg-muted/60",
      )}
    >
      <SeriesKey color={color} />
      <span className={muted ? "line-through" : undefined}>{label}</span>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/** Everyone on the chart, each droppable, plus everyone dropped, each
 * restorable — the "drop" half of pick-and-drop, for people a preset or a
 * tag brought in rather than ones added by hand. Grouped by why they're
 * shown, so it's clear which control put them there. */
function Roster({
  shown,
  excluded,
  colorOf,
  onDrop,
  onRestore,
}: {
  shown: ShownPerson[];
  excluded: string[];
  colorOf: (name: string) => string;
  onDrop: (name: string) => void;
  onRestore: (name: string) => void;
}) {
  const groups = new Map<string, ShownPerson[]>();
  for (const person of shown) {
    const key =
      person.via.kind === "person" ? "Added by name" : person.via.kind === "tag" ? person.via.tag : "Starting set";
    groups.set(key, [...(groups.get(key) ?? []), person]);
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-foreground/10 p-3">
      {[...groups.entries()].map(([heading, people]) => (
        <div key={heading} className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</span>
          <div className="flex flex-wrap gap-1.5">
            {people.map(({ name }) => (
              <Chip key={name} color={colorOf(name)} label={name} removeLabel={`Drop ${name}`} onRemove={() => onDrop(name)} />
            ))}
          </div>
        </div>
      ))}
      {excluded.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dropped</span>
          <div className="flex flex-wrap gap-1.5">
            {excluded.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onRestore(name)}
                aria-label={`Restore ${name}`}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-foreground/20 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <span className="line-through">{name}</span>
                <span aria-hidden>+</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SearchOption =
  | { kind: "tag"; name: string; color: string | null; members: number }
  | { kind: "person"; name: string; color: string | null; tagName: string | null; daysLogged: number };

/** How many matches the dropdown lists. Past this, typing more narrows
 * faster than scrolling would. */
const MAX_SEARCH_OPTIONS = 12;

/**
 * Search box for adding a person or a whole group — legacy's search panel,
 * which matched names and nicknames and listed tags alongside people.
 *
 * A hand-rolled combobox rather than a library one: it's one input and one
 * list, and the ARIA pattern (combobox + listbox + aria-activedescendant,
 * focus never leaving the input) is small enough to own outright.
 */
function PeopleSearch({
  timeline,
  nicknames,
  shown,
  selectedTags,
  onAddPerson,
  onAddTag,
}: {
  timeline: ImpactTimeline;
  nicknames: Record<string, string[]>;
  shown: ShownPerson[];
  selectedTags: string[];
  onAddPerson: (name: string) => void;
  onAddTag: (tag: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const tags = useMemo(() => impactTrendTags(timeline), [timeline]);

  const options = useMemo<SearchOption[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (text: string) => text.toLowerCase().includes(q);
    const shownNames = new Set(shown.map((p) => p.name));
    const tagOptions: SearchOption[] = tags
      .filter((t) => !selectedTags.includes(t.name) && (!q || matches(t.name)))
      .map((t) => ({ kind: "tag", ...t }));
    // Most-logged first, which is also the order an empty query lists them in.
    const personOptions: SearchOption[] = timeline.people
      .filter((p) => !shownNames.has(p.name) && (!q || matches(p.name) || (nicknames[p.name] ?? []).some(matches)))
      .map((p) => ({ kind: "person", name: p.name, color: p.tagColor, tagName: p.tagName, daysLogged: p.daysLogged }));
    // Groups first when searching (there are few, and a name match on one is
    // a strong signal); with no query, a handful of each.
    return q
      ? [...tagOptions, ...personOptions].slice(0, MAX_SEARCH_OPTIONS)
      : [...tagOptions.slice(0, 4), ...personOptions.slice(0, MAX_SEARCH_OPTIONS - Math.min(4, tagOptions.length))];
  }, [query, tags, selectedTags, timeline, shown, nicknames]);

  const activeIndex = Math.min(active, options.length - 1);

  const choose = (option: SearchOption) => {
    if (option.kind === "tag") onAddTag(option.name);
    else onAddPerson(option.name);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`${listId}-input`}
        className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Add people
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length > 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder="Name or group…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive(Math.min(options.length - 1, activeIndex + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(0, activeIndex - 1));
            } else if (event.key === "Enter" && open && options[activeIndex]) {
              event.preventDefault();
              choose(options[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="h-7 w-56 rounded-md border border-input bg-transparent pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        {open && options.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="People and groups"
            className="absolute top-full left-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-foreground/10 bg-popover p-1 text-popover-foreground shadow-md"
          >
            {options.map((option, i) => (
              <li
                key={`${option.kind}:${option.name}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // mousedown, not click: the input's blur would close the
                // list before a click landed.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                  i === activeIndex && "bg-muted",
                )}
              >
                <SeriesKey color={option.color ?? CONTEXT_COLOR} />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {option.kind === "tag"
                    ? `group · ${option.members} ${option.members === 1 ? "person" : "people"}`
                    : `${option.tagName ? `${option.tagName} · ` : ""}${formatThousandsNumber(option.daysLogged)}d`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
