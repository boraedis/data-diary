import type { PeopleDay } from "@/lib/charts";
import { personImpact } from "@/lib/impact";
import { computeRankings, STANDARD_RANK_WINDOWS, type RankAppearance } from "@/lib/ranking";
import { toLeaderboardRows, type LeaderboardColumns, type LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// The people leaderboard (#115): who (or which tag) ranks highest, by
// plain mentions or by legacy's impact score. Pure — the page passes in
// `getPeopleDailyData`'s rows.

export type PeopleMode = "mentions" | "impact" | "tag-mentions" | "tag-impact";

export const PEOPLE_MODES: LeaderboardOption<PeopleMode>[] = [
  { id: "mentions", label: "Most Mentioned" },
  { id: "impact", label: "Impact Score" },
  { id: "tag-mentions", label: "Tag Mentions" },
  { id: "tag-impact", label: "Tag Impact" },
];

const UNTAGGED = "Untagged";

/**
 * Ranks people or tags.
 *
 * - **Mentions** — days logged, one per day a person appears.
 * - **Impact** — the sum of `personImpact(day's happiness, slot)` over
 *   every day they appear: the same per-day score People Impact charts by
 *   period, without that chart's top-five fold. Days with no happiness
 *   score are skipped, not scored as zero — the same call People Impact
 *   makes, since there's no impact to compute without one.
 * - **Tag** modes — the same two, credited to each person's tag. Mentions
 *   sum person-appearances (three friends from one group on one day is
 *   three), because the question is how much of your time that group
 *   fills, not merely whether it showed up. People without a tag rank
 *   together as "Untagged" rather than vanishing.
 *
 * A person's tag is the one on each day's row, so a retag moves future
 * mentions without rewriting old ones. The row's label and colour use
 * their latest tag — the "who are they now" reading the table has always
 * had.
 */
export function buildPeopleLeaderboard(data: PeopleDay[], mode: PeopleMode): LeaderboardRow[] {
  const byTag = mode === "tag-mentions" || mode === "tag-impact";
  const byImpact = mode === "impact" || mode === "tag-impact";

  const appearances: RankAppearance[] = [];
  const latestTag = new Map<string, { name: string | null; color: string | null }>();
  const tagColor = new Map<string, string | null>();
  let asOf = "";
  for (const day of data) {
    if (day.date > asOf) asOf = day.date;
    for (const person of day.people) latestTag.set(person.name, { name: person.tagName, color: person.tagColor });
    if (byImpact && day.happiness === null) continue;
    for (const person of day.people) {
      const key = byTag ? (person.tagName ?? UNTAGGED) : person.name;
      if (byTag) tagColor.set(key, person.tagColor);
      appearances.push({
        key,
        date: day.date,
        weight: byImpact ? personImpact(day.happiness as number, person.slot) : 1,
      });
    }
  }
  if (!asOf || appearances.length === 0) return [];

  const ranked = computeRankings(appearances, asOf, STANDARD_RANK_WINDOWS);
  return toLeaderboardRows(ranked, STANDARD_RANK_WINDOWS, (key) => {
    if (byTag) return { name: key, color: tagColor.get(key) ?? null };
    const tag = latestTag.get(key);
    return { name: key, context: tag?.name ?? null, color: tag?.name ? tag.color : null };
  });
}

export function peopleColumns(mode: PeopleMode): LeaderboardColumns {
  switch (mode) {
    case "mentions":
      return {
        nameHeader: "Name",
        contextHeader: "Tag",
        contextDescription: "How I know them, in the tag's own colour.",
        valueHeader: "Days",
        valueFormat: "count",
        gainedNoun: "days gained",
      };
    case "impact":
      return {
        nameHeader: "Name",
        contextHeader: "Tag",
        contextDescription: "How I know them, in the tag's own colour.",
        valueHeader: "Impact",
        valueDescription: "Summed impact score across every scored day they appear — the legacy formula People Impact uses.",
        valueFormat: "score",
        countHeader: "Days",
        countDescription: "Scored days they appear on.",
        gainedNoun: "impact gained",
      };
    case "tag-mentions":
      return {
        nameHeader: "Tag",
        valueHeader: "Mentions",
        valueDescription: "Person-days: each tagged person on each day counts once.",
        valueFormat: "count",
        gainedNoun: "mentions gained",
      };
    case "tag-impact":
      return {
        nameHeader: "Tag",
        valueHeader: "Impact",
        valueDescription: "Summed impact score of everyone with this tag, across every scored day.",
        valueFormat: "score",
        countHeader: "Mentions",
        countDescription: "Person-days on scored days.",
        gainedNoun: "impact gained",
      };
  }
}
