/**
 * Shared people-list ordering for the day-entry "add a person" picker
 * (issue #73). Deliberately has no DB or server-only dependencies (same
 * convention as src/lib/place-sort.ts) so client components can import it
 * directly without pulling drizzle/neon into the client bundle — the actual
 * mention stats come from getPeopleMentionStats in src/lib/days.ts and are
 * passed in already computed.
 */

import { parseDate, todayDateString } from "@/lib/date";

type PersonMentionLike = { totalCount: number; mostRecentDate: string | null };
type PersonLike = { id: number; name: string };

// How quickly a mention's recency boost fades to (near) zero, in days.
// Issue #73 asked for "recent mentions win, but overall sorted by total
// count" without a precise legacy formula to port, so this is a fresh
// design: an exponential decay keeps someone mentioned yesterday near the
// top for roughly a month, tapering off smoothly rather than a hard cutoff,
// while people who haven't come up recently fall back to ranking by their
// lifetime total (see score() below — totalCount is always added in full,
// recencyBoost decays toward 0).
const RECENCY_DECAY_DAYS = 10;
const RECENCY_BOOST_MAX = 50;

function daysBetween(from: string, to: string): number {
  const ms = parseDate(to).getTime() - parseDate(from).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

function score(stats: PersonMentionLike | undefined, today: string): number {
  if (!stats) return 0;
  const recencyBoost = stats.mostRecentDate
    ? RECENCY_BOOST_MAX * Math.exp(-daysBetween(stats.mostRecentDate, today) / RECENCY_DECAY_DAYS)
    : 0;
  return stats.totalCount + recencyBoost;
}

/** Highest recency-weighted score first (someone mentioned once yesterday
 * can outrank someone mentioned 5x a year ago), then name as the tiebreak —
 * most commonly hit by two people who've never been mentioned, both scoring
 * exactly 0. */
export function comparePeopleByRecencyAndMentions(mentionStats: Map<number, PersonMentionLike>) {
  const today = todayDateString();
  return (a: PersonLike, b: PersonLike): number => {
    const diff = score(mentionStats.get(b.id), today) - score(mentionStats.get(a.id), today);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  };
}
