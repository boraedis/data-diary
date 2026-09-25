import type { PeopleDay } from "@/lib/charts";
import { addDays, daysBetween } from "@/lib/date";
import { personImpact, recencyWeight } from "@/lib/impact";
import { rankSnapshots, STANDARD_RANK_WINDOWS, type RankSnapshot } from "@/lib/ranking";
import { toLeaderboardRows, type LeaderboardColumns, type LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// The people leaderboard (#115, #428): everyone — or every tag — ranked by
// legacy's recency-faded impact score, with plain mentions alongside.
// Pure; the page passes in `getPeopleDailyData`'s rows.
//
// One table per grouping rather than separate "mentions" and "impact"
// tables: every column sorts, so the Days column *is* the mentions
// leaderboard one click away. Impact is the default order because it's
// the more meaningful reading — mentions only ever grow, so the same
// early names sit on top forever.

export type PeopleMode = "people" | "tags";

export const PEOPLE_MODES: LeaderboardOption<PeopleMode>[] = [
  { id: "people", label: "People" },
  { id: "tags", label: "Tags" },
];

const UNTAGGED = "Untagged";

type Appearance = { key: string; date: string; impact: number | null };

/** Recency-faded impact as it stood on `at`: each scored appearance on or
 * before `at`, weighted by how long before `at` it was. */
function fadedImpact(appearances: Appearance[], at: string): number {
  let total = 0;
  for (const a of appearances) {
    if (a.impact === null || a.date > at) continue;
    total += a.impact * recencyWeight(daysBetween(a.date, at));
  }
  return total;
}

/**
 * Ranks people or tags by recency-faded impact.
 *
 * **The score is the People Race's**, not People Impact's plain sum: each
 * day a person appears contributes `personImpact(day's happiness, slot)`,
 * weighted by `recencyWeight(days before now)` — legacy's arctan fade,
 * which holds near full weight for a few months, halves around a year and
 * flattens onto a floor. So this ranks who matters *now*: someone who
 * dropped out of your life slides down over a year or two rather than
 * holding an unassailable lifetime total. Days with no happiness score
 * have no impact to compute and are skipped, as they are everywhere else.
 *
 * **Movement stays point-in-time**, which the fade makes more than a
 * cut-off sum: "a month ago" re-weights every earlier day relative to that
 * date, exactly as the race's frame for that date would. The gained figure
 * is therefore a net change and can be negative — a quiet month *loses*
 * score as old days fade.
 *
 * **Mentions** count every day logged, scored or not. Tag mode sums
 * person-days: three friends from one group on one day is three.
 *
 * A person's tag is the one on each day's row, so a retag moves future
 * mentions without rewriting old ones; the row's label and colour use
 * their latest tag.
 */
export function buildPeopleLeaderboard(data: PeopleDay[], mode: PeopleMode): LeaderboardRow[] {
  const byTag = mode === "tags";
  const byKey = new Map<string, Appearance[]>();
  const latestTag = new Map<string, { name: string | null; color: string | null }>();
  const tagColor = new Map<string, string | null>();
  let asOf = "";

  for (const day of data) {
    if (day.date > asOf) asOf = day.date;
    for (const person of day.people) {
      latestTag.set(person.name, { name: person.tagName, color: person.tagColor });
      const key = byTag ? (person.tagName ?? UNTAGGED) : person.name;
      if (byTag) tagColor.set(key, person.tagColor);
      const list = byKey.get(key) ?? [];
      list.push({
        key,
        date: day.date,
        impact: day.happiness === null ? null : personImpact(day.happiness, person.slot),
      });
      byKey.set(key, list);
    }
  }
  if (!asOf || byKey.size === 0) return [];

  const cutoffs = STANDARD_RANK_WINDOWS.map((w) => addDays(asOf, -w.days));
  const snapshots: RankSnapshot[] = [...byKey.entries()].map(([key, appearances]) => {
    const before: Record<string, number | null> = {};
    STANDARD_RANK_WINDOWS.forEach((w, i) => {
      // Ranked then only if they'd appeared by then at all.
      const present = appearances.some((a) => a.date <= cutoffs[i]);
      before[w.id] = present ? fadedImpact(appearances, cutoffs[i]) : null;
    });
    return { key, total: fadedImpact(appearances, asOf), occurrences: appearances.length, before };
  });

  const ranked = rankSnapshots(snapshots, STANDARD_RANK_WINDOWS);
  return toLeaderboardRows(ranked, STANDARD_RANK_WINDOWS, (key) => {
    if (byTag) return { name: key, color: tagColor.get(key) ?? null };
    const tag = latestTag.get(key);
    return { name: key, context: tag?.name ?? null, color: tag?.name ? tag.color : null };
  });
}

const IMPACT_DESCRIPTION =
  "Legacy's impact score with its recency fade: each scored day counts by how much it mattered, weighted down the longer ago it was. Sort by Days for plain mentions.";

export function peopleColumns(mode: PeopleMode): LeaderboardColumns {
  if (mode === "tags") {
    return {
      nameHeader: "Tag",
      valueHeader: "Impact",
      valueDescription: IMPACT_DESCRIPTION,
      valueFormat: "score",
      countHeader: "Mentions",
      countDescription: "Person-days: each tagged person on each day counts once.",
      gainedNoun: "net impact change",
    };
  }
  return {
    nameHeader: "Name",
    contextHeader: "Tag",
    contextDescription: "How I know them, in the tag's own colour.",
    valueHeader: "Impact",
    valueDescription: IMPACT_DESCRIPTION,
    valueFormat: "score",
    countHeader: "Days",
    countDescription: "Every day they were logged, scored or not.",
    gainedNoun: "net impact change",
  };
}
