import { daysBetween } from "@/lib/date";
import { personImpact, recencyWeight } from "@/lib/impact";
import type { PeopleDay } from "@/lib/charts";

// Pure scoring + selection for the People Impact Trend chart — legacy's
// `people_impact_averager.js`, the one-line-per-person impact chart with a
// hand-picked roster. Split from the component for the same reason
// life-timeline.ts is: the decisions worth testing (what a point means,
// who a preset or a tag pulls in) shouldn't need a rendered chart.
//
// **What a point is.** Every calendar day has a *standing* per person —
// the recency-weighted sum of every impact they ever scored up to that day
// (`recencyWeight(age) × personImpact(day's happiness, slot)`, the same
// curve the bar race uses) — and the chart plots it **for every day, with
// no averaging**. Legacy averaged it per week/month/quarter/year; the user
// asked for the raw daily line instead (#441), and since the fader is
// already a year-scale smoother, the daily line is readable on its own. So
// the line is "who mattered around then", not "how often did I see them
// that week": it jumps a little on each day they're logged, holds while
// they're in your days, and eases back toward the fader's floor over the
// year or two after they leave rather than dropping to zero.
//
// **How it's computed.** `dailyStandings` spreads each appearance forward
// over the days after it — one pass per appearance, the same work legacy's
// loop of every day over every earlier day did, minus the days nobody was
// logged. It's cached per timeline and person, so re-picking the roster
// only computes the people it adds. The top-impact preset ranks by
// `meanStanding` over the whole history instead, which has a closed form
// over a prefix sum of the fader (see its own comment) and so ranks
// hundreds of people without building a daily series for any of them.

/** Legacy's `START + 150`: the opening months are a handful of days against
 * an empty history, so every standing is still climbing from zero — a ramp
 * that says nothing about anyone. The bar race drops its opening weeks for
 * the same reason (`RACE_WARM_UP_DAYS`). */
export const IMPACT_TREND_WARM_UP_DAYS = 150;

/** How many people a "top" preset pulls in — legacy's `TOP_N`. */
export const IMPACT_TREND_TOP_N = 30;

/** Legacy's `people_list` cut (`sum >= 15`): a tag pulls in only the
 * members logged at least this often. A tag can hold dozens of people met
 * once or twice; those lines would sit flat on the fader's floor and bury
 * the members the group actually means. Someone below the cut can still be
 * added by name — the cut applies to what a tag *implies*, not to who can
 * be shown. */
export const TAG_MEMBER_MIN_DAYS = 15;

export type ImpactTrendPerson = {
  name: string;
  tagName: string | null;
  tagColor: string | null;
  /** Every day they were logged, scored or not — "days logged" means the
   * log, not the subset the impact score can read. */
  daysLogged: number;
};

type Appearances = {
  /** Day index (days since `start`) of each scored appearance, ascending. */
  day: Int32Array;
  score: Float64Array;
  /** Day index of every appearance, scored or not — for day counts. */
  loggedDay: Int32Array;
};

export type ImpactTimeline = {
  /** Day 0: the first day with a happiness score (legacy's `START`). */
  start: string;
  /** The last logged day — the history's end, not today. A standing keeps
   * being defined after it, but extending every line to today would plot
   * a slow decay nobody logged. */
  end: string;
  /** `end`'s day index. */
  lastDay: number;
  /** `weight[age]` = `recencyWeight(age)`, as a lookup table. */
  weight: Float64Array;
  /** `cumulativeWeight[k]` = Σ `recencyWeight(0..k)`. */
  cumulativeWeight: Float64Array;
  appearances: Map<string, Appearances>;
  /** Everyone ever logged, most-logged first — the search list's order. */
  people: ImpactTrendPerson[];
  byName: Map<string, ImpactTrendPerson>;
};

/**
 * Indexes the people log for scoring. Run once per data load; everything
 * below reads this rather than the raw days.
 *
 * Days with no happiness score still count toward `daysLogged` but add no
 * impact — the score is a function of the day's happiness, so there's
 * nothing to add (the same call every other impact chart makes; legacy
 * summed the NaN it got from them).
 */
export function buildImpactTimeline(data: PeopleDay[]): ImpactTimeline | null {
  const firstScored = data.find((day) => day.happiness !== null);
  if (!firstScored) return null;
  const start = firstScored.date;
  const end = data[data.length - 1].date;
  const lastDay = daysBetween(start, end);

  const weight = new Float64Array(lastDay + 1);
  const cumulativeWeight = new Float64Array(lastDay + 1);
  let running = 0;
  for (let age = 0; age <= lastDay; age++) {
    weight[age] = recencyWeight(age);
    running += weight[age];
    cumulativeWeight[age] = running;
  }

  const scored = new Map<string, { day: number[]; score: number[] }>();
  const logged = new Map<string, number[]>();
  const meta = new Map<string, { tagName: string | null; tagColor: string | null }>();
  for (const day of data) {
    // Days before the first scored one are outside the timeline entirely —
    // there's no day 0 for them to be counted from.
    if (day.date < start) continue;
    const index = daysBetween(start, day.date);
    for (const person of day.people) {
      // Latest tag wins, the same "who are they now" reading the race uses.
      meta.set(person.name, { tagName: person.tagName, tagColor: person.tagColor });
      let days = logged.get(person.name);
      if (!days) logged.set(person.name, (days = []));
      days.push(index);
      if (day.happiness === null) continue;
      let entry = scored.get(person.name);
      if (!entry) scored.set(person.name, (entry = { day: [], score: [] }));
      entry.day.push(index);
      entry.score.push(personImpact(day.happiness, person.slot));
    }
  }

  const appearances = new Map<string, Appearances>();
  const people: ImpactTrendPerson[] = [];
  for (const [name, loggedDays] of logged) {
    const entry = scored.get(name);
    appearances.set(name, {
      day: Int32Array.from(entry?.day ?? []),
      score: Float64Array.from(entry?.score ?? []),
      loggedDay: Int32Array.from(loggedDays),
    });
    const { tagName, tagColor } = meta.get(name)!;
    people.push({ name, tagName, tagColor, daysLogged: loggedDays.length });
  }
  people.sort((a, b) => b.daysLogged - a.daysLogged || a.name.localeCompare(b.name));

  return {
    start,
    end,
    lastDay,
    weight,
    cumulativeWeight,
    appearances,
    people,
    byName: new Map(people.map((p) => [p.name, p])),
  };
}

/**
 * A person's mean standing over days `s..e` (inclusive day indices), or
 * `null` when there's nothing to average — what the top-impact preset
 * ranks by.
 *
 * Starts from their first appearance rather than from `s`: before it their
 * standing is exactly zero, and averaging those zeros in would rank someone
 * met late in the history below where their line actually sits.
 *
 * Closed form: the days `[s, e]` see an appearance on day `j` at ages
 * `max(s,j)-j … e-j`, so its whole contribution is
 * `score × (C[e-j] - C[max(s,j)-j-1])` with `C` the cumulative weights —
 * one pass over the person's appearances, not one per day.
 */
export function meanStanding(timeline: ImpactTimeline, name: string, s: number, e: number): number | null {
  const a = timeline.appearances.get(name);
  if (!a || a.day.length === 0) return null;
  const from = Math.max(s, a.day[0]);
  if (from > e) return null;
  const C = timeline.cumulativeWeight;
  let total = 0;
  for (let k = 0; k < a.day.length; k++) {
    const j = a.day[k];
    if (j > e) break;
    const lo = Math.max(from, j) - j;
    total += a.score[k] * (C[e - j] - (lo > 0 ? C[lo - 1] : 0));
  }
  return total / (e - from + 1);
}

/** Days logged within `s..e`. */
function daysLoggedIn(timeline: ImpactTimeline, name: string, s: number, e: number): number {
  const days = timeline.appearances.get(name)?.loggedDay;
  if (!days) return 0;
  let count = 0;
  for (const d of days) {
    if (d > e) break;
    if (d >= s) count++;
  }
  return count;
}

const standingsCache = new WeakMap<ImpactTimeline, Map<string, Float64Array>>();

/**
 * A person's standing on every day of the timeline, indexed by day. Zero
 * before their first appearance.
 *
 * Cached per timeline (a `WeakMap`, so a page's cache goes when its data
 * does): a series is the one expensive thing here — appearances × the days
 * after each — and it never changes for a given load, so adding a tag
 * computes only the people it brings in.
 */
export function dailyStandings(timeline: ImpactTimeline, name: string): Float64Array {
  let cache = standingsCache.get(timeline);
  if (!cache) standingsCache.set(timeline, (cache = new Map()));
  const cached = cache.get(name);
  if (cached) return cached;

  const out = new Float64Array(timeline.lastDay + 1);
  const a = timeline.appearances.get(name);
  if (a) {
    const W = timeline.weight;
    for (let k = 0; k < a.day.length; k++) {
      const j = a.day[k];
      const score = a.score[k];
      for (let i = j; i <= timeline.lastDay; i++) out[i] += score * W[i - j];
    }
  }
  cache.set(name, out);
  return out;
}

/**
 * The two "top" presets.
 *
 * - `impact`: highest mean standing over the whole history — the area
 *   under their line, i.e. who the chart itself says mattered most.
 * - `logged`: most days logged.
 *
 * Both are ranked over the **whole history**, never the visible range: the
 * time range picker is a pure x-axis view (#441), so dragging it must not
 * change who's on the chart. Ties break by name so the preset doesn't
 * reshuffle between renders.
 */
export type TopPreset = "impact" | "logged";

export function rankPeople(timeline: ImpactTimeline, by: TopPreset, s: number, e: number, limit: number): string[] {
  const scored: { name: string; value: number }[] = [];
  for (const { name } of timeline.people) {
    const value = by === "impact" ? meanStanding(timeline, name, s, e) : daysLoggedIn(timeline, name, s, e);
    if (value !== null && value > 0) scored.push({ name, value });
  }
  scored.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((p) => p.name);
}

/**
 * Who the chart shows, as the reader built it.
 *
 * Legacy's model, extended: legacy either showed the defaults *or* the
 * hand-picked list, and dropped a hand-picked person whose tag was also
 * picked. Here the pieces compose — a preset, plus whole tags, plus
 * individuals — so a group view can take in the people who straddle
 * groups, which is the reason to pick people by hand at all. `excluded`
 * is the "drop" half: anyone a preset or tag brought in can be taken out
 * without giving up the rest of it.
 */
export type ImpactTrendSelection = {
  preset: TopPreset | "none";
  tags: string[];
  /** Hand-picked, in the order they were added — that order is also their
   * colour slot in "person" colouring, so it stays stable as others come
   * and go. */
  people: string[];
  excluded: string[];
};

export type ShownPerson = {
  name: string;
  /** Why they're on the chart — shown in the roster so a reader can tell
   * which control to change to drop them. First source wins, in the order
   * hand-picked → tag → preset. */
  via: { kind: "person" } | { kind: "tag"; tag: string } | { kind: "preset" };
};

export function resolveSelection(timeline: ImpactTimeline, selection: ImpactTrendSelection): ShownPerson[] {
  const excluded = new Set(selection.excluded);
  const shown = new Map<string, ShownPerson>();
  const add = (name: string, via: ShownPerson["via"]) => {
    if (!shown.has(name) && !excluded.has(name) && timeline.byName.has(name)) shown.set(name, { name, via });
  };

  for (const name of selection.people) add(name, { kind: "person" });
  for (const tag of selection.tags) {
    for (const person of timeline.people) {
      if (person.tagName === tag && person.daysLogged >= TAG_MEMBER_MIN_DAYS) add(person.name, { kind: "tag", tag });
    }
  }
  if (selection.preset !== "none") {
    for (const name of rankPeople(timeline, selection.preset, 0, timeline.lastDay, IMPACT_TREND_TOP_N)) {
      add(name, { kind: "preset" });
    }
  }
  return [...shown.values()];
}

/** Every tag in use, with its colour and how many members clear
 * `TAG_MEMBER_MIN_DAYS` — the count the search list shows, so picking a
 * tag says up front how many lines it's about to add. Tags with no
 * qualifying members are left out: picking one would add nothing. */
export function impactTrendTags(timeline: ImpactTimeline): { name: string; color: string | null; members: number }[] {
  const tags = new Map<string, { name: string; color: string | null; members: number }>();
  for (const person of timeline.people) {
    if (!person.tagName || person.daysLogged < TAG_MEMBER_MIN_DAYS) continue;
    const tag = tags.get(person.tagName) ?? { name: person.tagName, color: person.tagColor, members: 0 };
    tag.members++;
    tags.set(person.tagName, tag);
  }
  return [...tags.values()].sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
}
