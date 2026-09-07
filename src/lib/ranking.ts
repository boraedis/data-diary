import { addDays } from "@/lib/date";

/**
 * Point-in-time rank movement (#211).
 *
 * Legacy's `people_table` showed trailing *counts* — appearances in the
 * last 7, 31 and 365 days — which answers "how much lately" but not "who's
 * rising". This computes movement instead.
 *
 * **The definition, since there are several plausible ones: a window's rank
 * is the standing as it was at that point in time.** The week column asks
 * "where did this person rank a week ago, counting everything up to then?"
 * and compares it with where they rank now. Both sides are all-time
 * standings; only the moment differs.
 *
 * The alternative — ranking the last 7 days against the 7 before them —
 * measures something different and noisier: it answers "who was around
 * most this week" rather than "whose overall standing moved". Two people
 * can swap places in a single week's activity without either one's actual
 * position changing at all. Point-in-time is also the version where the
 * movement column agrees with the number beside it, since the table is
 * sorted by the all-time total.
 *
 * A consequence worth knowing: over a long history the year column moves a
 * lot and the week column barely moves, because a week of days can rarely
 * shift a total built over years. That's the honest reading rather than a
 * flaw — a big week jump means something genuinely unusual happened.
 */
export type RankWindow = { id: string; label: string; days: number };

export type RankMovement = {
  /** Positions gained since that point in time — positive is upward (a
   * numerically smaller rank). Null when the person hadn't appeared at all
   * yet, so there was no position to move from. */
  delta: number | null;
  /** First appeared inside this window: they weren't in the ranking at
   * that point, which is a different statement from "unchanged". */
  isNew: boolean;
};

export type RankedItem = {
  key: string;
  /** Appearances across the whole history — what the table is sorted by. */
  total: number;
  /** Appearances gained inside each window. */
  counts: Record<string, number>;
  movements: Record<string, RankMovement>;
};

/** Ranks keys by count, descending. Ties share the better rank, so two keys
 * level on 10 days are both 1st and the next is 3rd — otherwise an
 * arbitrary tiebreak would show as movement when nothing had changed. */
function rankByCount(counts: Map<string, number>): Map<string, number> {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const ranks = new Map<string, number>();
  let rank = 0;
  let previousCount: number | null = null;
  sorted.forEach(([key, count], index) => {
    if (count !== previousCount) {
      rank = index + 1;
      previousCount = count;
    }
    ranks.set(key, rank);
  });
  return ranks;
}

/** Cumulative appearances per key up to and including `through`. */
function cumulativeThrough(
  appearances: { key: string; date: string }[],
  through: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of appearances) {
    if (a.date <= through) counts.set(a.key, (counts.get(a.key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Totals and point-in-time rank movement per key.
 *
 * `asOf` anchors every window — pass the latest logged date rather than
 * today, so a gap in logging doesn't shift every window past the end of
 * the data and report movement that is really just absence.
 */
export function computeRankings(
  appearances: { key: string; date: string }[],
  asOf: string,
  windows: RankWindow[],
): RankedItem[] {
  const nowCounts = cumulativeThrough(appearances, asOf);
  const nowRanks = rankByCount(nowCounts);

  const perWindow = windows.map((window) => {
    const thenDate = addDays(asOf, -window.days);
    const thenCounts = cumulativeThrough(appearances, thenDate);
    return { window, thenCounts, thenRanks: rankByCount(thenCounts) };
  });

  return [...nowCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => {
      const counts: Record<string, number> = {};
      const movements: Record<string, RankMovement> = {};
      for (const { window, thenCounts, thenRanks } of perWindow) {
        counts[window.id] = total - (thenCounts.get(key) ?? 0);
        const now = nowRanks.get(key) as number;
        const before = thenRanks.get(key);
        if (before === undefined) {
          // They weren't in the ranking at that point at all, so there is
          // no position to have moved from. Treating "absent" as "last"
          // would report an enormous rise for anyone recently met.
          movements[window.id] = { delta: null, isNew: true };
        } else {
          movements[window.id] = { delta: before - now, isNew: false };
        }
      }
      return { key, total, counts, movements };
    });
}
