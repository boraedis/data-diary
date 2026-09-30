import type { PeopleDay } from "@/lib/charts";
import { categoricalColor, CATEGORICAL_SLOT_COUNT } from "@/lib/viz/color";
import { buildTreeFromLevels, type HierarchyDatum } from "@/lib/viz/hierarchy";

// The People Treemap's tree (#213), kept pure and out of the component —
// the same split `life-timeline.ts` has from its chart. Legacy's
// `people_treemap.js` grouped everyone by tag and sized each person by
// their running count of logged days; this builds that same tree as a
// `HierarchyDatum`, through `hierarchy.ts`'s builders rather than a
// hand-rolled `d3.group`.

export type PeopleTreemapGrouping = "tag" | "none";

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
 * The treemap's tree: every person, sized by the number of days they
 * appear on in `days`, either grouped under their tag or flat.
 *
 * `days` is `getPeopleDailyData`'s output — positive slots only, and
 * deduplicated per day (see that function), so a person in two slots on
 * one day counts once — cut down to whatever the chart is showing: the
 * whole history, or everything up to a time-lapse frame. `colors` comes
 * from `tagColors` over the *unfiltered* history.
 *
 * The tree's *shape* always comes from `roster` (the whole history), not
 * from `days`: someone not yet logged by a frame is still a leaf, just
 * worth zero. That's what lets InteractiveTreemap animate one frame into
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
  days: PeopleDay[],
  grouping: PeopleTreemapGrouping,
  colors: Map<string, string>,
  roster: PeopleDay[] = days,
): HierarchyDatum | null {
  const counts = new Map<string, number>();
  for (const day of days) {
    for (const person of day.people) counts.set(person.name, (counts.get(person.name) ?? 0) + 1);
  }
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
    value: counts.get(row.name) ?? 0,
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
