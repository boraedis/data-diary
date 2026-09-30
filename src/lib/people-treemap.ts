import type { PeopleDay } from "@/lib/charts";
import { daysBetween } from "@/lib/date";
import { personImpact, recencyWeight } from "@/lib/impact";
import { categoricalColor, CATEGORICAL_SLOT_COUNT } from "@/lib/viz/color";
import { buildTreeFromLevels, type HierarchyDatum } from "@/lib/viz/hierarchy";

// The People Treemap's tree (#213), kept pure and out of the component —
// the same split `life-timeline.ts` has from its chart. Legacy's
// `people_treemap.js` grouped everyone by tag and sized each person by
// their running count of logged days; this builds that same tree as a
// `HierarchyDatum`, through `hierarchy.ts`'s builders rather than a
// hand-rolled `d3.group`.

export type PeopleTreemapGrouping = "tag" | "none";

/**
 * What a tile's area means.
 *  - `days`: days logged, a running count — legacy's own treemap metric.
 *  - `impact`: legacy's impact score with its recency fade, as of the
 *    month shown — the *same* number the People Race and the People
 *    Leaderboard rank by (see `fadedImpactAt`), so a person's tile here
 *    and their bar there always agree. Faded rather than a lifetime sum
 *    because that's what makes it a different picture from `days`: a
 *    lifetime total only grows, so it would be the days treemap with the
 *    tiles reweighted, while the fade lets someone who drifted out of your
 *    life shrink again as the time-lapse plays.
 */
export type PeopleTreemapMetric = "days" | "impact";

/** Untagged people read as "no group", not as a sixth group — the same
 * neutral the people network uses for them. */
export const UNTAGGED_COLOR = "var(--muted-foreground)";
export const UNTAGGED_NAME = "Untagged";

/**
 * Legacy's `getInitals`: first letter of each word, with a trailing roman
 * numeral dropped ("John Smith III" -> "JS"). Used as the tile's
 * `shortName`, so a tile too narrow for the name still says who it is.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const NUMERALS = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]);
  const kept = words.length > 1 && NUMERALS.has(words[words.length - 1]) ? words.slice(0, -1) : words;
  return kept.map((word) => word[0]).join("");
}

/**
 * One colour per tag, decided over the *whole* history rather than the
 * filtered range.
 *
 * A tag with its own colour (`tags.color`) keeps it. One without falls
 * back to a palette slot by its rank in total days — which is only stable
 * if the ranking is: done over the filtered days, narrowing the time
 * range could reorder two uncoloured tags and swap their colours, and
 * colour has to follow the entity, never its rank in the current view
 * (#220's rule). Wrapped modulo the slot count for the same reason
 * `defaultColorOf` wraps: a many-branch chart painted mostly one grey
 * reads as "these are all the same".
 */
export function tagColors(days: PeopleDay[]): Map<string, string> {
  const totals = new Map<string, { days: number; color: string | null }>();
  for (const day of days) {
    for (const person of day.people) {
      if (person.tagName === null) continue;
      const entry = totals.get(person.tagName) ?? { days: 0, color: person.tagColor };
      entry.days += 1;
      totals.set(person.tagName, entry);
    }
  }
  const colors = new Map<string, string>();
  let slot = 0;
  for (const [name, { color }] of [...totals].sort((a, b) => b[1].days - a[1].days || a[0].localeCompare(b[0]))) {
    colors.set(name, color ?? categoricalColor(slot++ % CATEGORICAL_SLOT_COUNT));
  }
  return colors;
}

/**
 * The treemap's tree: everyone in `roster`, each sized by `values` (one of
 * `dayCounts`, `lifetimeImpact` or `fadedImpactAt` below), either grouped
 * under their tag or flat.
 *
 * `roster` is `getPeopleDailyData`'s output over the *whole* history, and
 * `colors` comes from `tagColors` over the same.
 *
 * The tree's *shape* always comes from `roster`, never from `values`:
 * someone not yet logged by a frame is still a leaf, just worth zero. That's what lets InteractiveTreemap animate one frame into
 * the next — it tweens a tree in place only while its key paths stay the
 * same, and a person popping into existence mid-playback would change
 * them. So there's no pruning here; a zero tile is simply not drawn.
 *
 * Flat mode still colours each tile by its tag: the grouping moves the
 * tiles around, it doesn't change what their colour means.
 *
 * Returns `null` when the roster is empty.
 */
export function buildPeopleTree(
  roster: PeopleDay[],
  values: Map<string, number>,
  grouping: PeopleTreemapGrouping,
  colors: Map<string, string>,
): HierarchyDatum | null {
  const everyone = new Map<string, { name: string; tagName: string | null }>();
  for (const day of roster) {
    for (const person of day.people) {
      if (!everyone.has(person.name)) everyone.set(person.name, { name: person.name, tagName: person.tagName });
    }
  }
  if (everyone.size === 0) return null;
  const rows = [...everyone.values()];
  const colorOf = (tagName: string | null) => (tagName === null ? UNTAGGED_COLOR : (colors.get(tagName) ?? UNTAGGED_COLOR));

  const toLeaf = (row: (typeof rows)[number]): HierarchyDatum => ({
    // Person names are unique in the schema, so the name is a safe key.
    key: row.name,
    name: row.name,
    value: values.get(row.name) ?? 0,
    shortName: initialsOf(row.name),
    // Read only when a person is itself a top-level branch (flat mode) —
    // grouped, the colour comes from the tag node above it.
    color: colorOf(row.tagName),
  });

  if (grouping === "none") {
    return { key: "__root__", name: "Everyone", children: rows.map(toLeaf) };
  }

  const tree = buildTreeFromLevels(rows, {
    rootName: "Everyone",
    levels: [{ of: (row) => row.tagName, fallback: UNTAGGED_NAME }],
    toLeaf,
  });
  // `buildTreeFromLevels` makes plain grouping nodes; the tag's own
  // colour goes on them here, since that's the depth-1 branch the
  // primitive reads a branch's colour from.
  return {
    ...tree,
    children: tree.children?.map((group) => ({
      ...group,
      color: group.name === UNTAGGED_NAME ? UNTAGGED_COLOR : colorOf(group.name),
    })),
  };
}

// --- Tile values ------------------------------------------------------------
//
// `days` is `getPeopleDailyData`'s output: positive slots only, and
// deduplicated per day (see that function), so a person in two slots on one
// day counts once — and, for impact, is scored by their earliest slot.

/** Days each person was logged in `days`. */
export function dayCounts(days: PeopleDay[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of days) {
    for (const person of day.people) counts.set(person.name, (counts.get(person.name) ?? 0) + 1);
  }
  return counts;
}

/** A day's impact contributions, flattened once so a time-lapse can score
 * every frame without re-deriving them. Days with no happiness score have
 * no impact to compute and are left out, as everywhere else impact is
 * used. */
export type ScoredDay = { date: string; people: { name: string; impact: number }[] };

export function scoreDays(days: PeopleDay[]): ScoredDay[] {
  return days
    .filter((day) => day.happiness !== null)
    .map((day) => ({
      date: day.date,
      people: day.people.map((person) => ({
        name: person.name,
        impact: personImpact(day.happiness as number, person.slot),
      })),
    }));
}

/**
 * Recency-faded impact as it stood on `at` ("YYYY-MM-DD"): every scored
 * appearance on or before `at`, weighted by `recencyWeight` of how long
 * before `at` it was. The People Race's and the People Leaderboard's
 * score, computed the same way.
 *
 * Floored at zero per person: the impact curve can in principle go
 * negative, and a negative area can't be drawn. It never does in this data
 * (the positive slots' curve stays above zero), which is why flooring is
 * honest rather than hiding something.
 */
export function fadedImpactAt(scored: ScoredDay[], at: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const day of scored) {
    if (day.date > at) break;
    const weight = recencyWeight(daysBetween(day.date, at));
    for (const { name, impact } of day.people) totals.set(name, (totals.get(name) ?? 0) + weight * impact);
  }
  for (const [name, total] of totals) if (total < 0) totals.set(name, 0);
  return totals;
}

/**
 * Plain, unfaded impact over everything in `scored`. Not a metric on the
 * page — it's the impact time-lapse's layout seed. The seed decides the
 * tiles' arrangement, and the faded score at the last month would give
 * someone who mattered enormously in 2018 but rarely since almost no room
 * in it; a lifetime total gives everyone room in proportion to how much
 * they ever mattered, so their tile has somewhere sensible to swell into
 * when the time-lapse reaches their year.
 */
export function lifetimeImpact(scored: ScoredDay[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const day of scored) {
    for (const { name, impact } of day.people) totals.set(name, (totals.get(name) ?? 0) + impact);
  }
  for (const [name, total] of totals) if (total < 0) totals.set(name, 0);
  return totals;
}
