import { addDays } from "@/lib/date";

/**
 * Rank movement over trailing windows (#211).
 *
 * Legacy's `people_table` showed trailing *counts* — appearances in the last
 * 7, 31 and 365 days — which answers "how much lately" but not "who's
 * rising". This computes actual movement instead, which is what was asked
 * for.
 *
 * **The definition, since there are several plausible ones:** a window's
 * rank is the person's position when ranked by appearances *inside that
 * window*, and movement compares it against their position in the window
 * immediately before it. So the week column is "last 7 days versus the 7
 * before that", not "now versus a week's worth of all-time".
 *
 * That choice matters. Ranking a trailing window against an all-time
 * position would make everyone appear to be falling, since all-time
 * position is dominated by years of history that a week can't move.
 * Comparing like-for-like windows is the only version where "up 3" means
 * something happened this week.
 */
export type RankWindow = { id: string; label: string; days: number };

export type RankMovement = {
  /** Positions gained since the previous window — positive is upward
   * (a numerically smaller rank). Null when the person appeared in
   * neither window, so there's no movement to speak of. */
  delta: number | null;
  /** Present in this window but not the one before: no delta exists, and
   * "new" is a different statement from "unchanged". */
  isNew: boolean;
};

export type RankedItem = {
  key: string;
  /** Appearances across the whole history — what the table is sorted by. */
  total: number;
  /** Appearances inside each window's current period. */
  counts: Record<string, number>;
  movements: Record<string, RankMovement>;
};

/** Ranks keys by count, descending. Ties share the better rank, so two
 * keys level on 10 days are both 1st and the next is 3rd — otherwise an
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

function countsInRange(
  appearances: { key: string; date: string }[],
  from: string,
  to: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of appearances) {
    if (a.date >= from && a.date <= to) counts.set(a.key, (counts.get(a.key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Totals and rank movement per key.
 *
 * `asOf` anchors every window — pass the latest logged date rather than
 * today, so a gap in logging doesn't silently empty the recent windows and
 * report everyone as having vanished.
 */
export function computeRankings(
  appearances: { key: string; date: string }[],
  asOf: string,
  windows: RankWindow[],
): RankedItem[] {
  const totals = new Map<string, number>();
  for (const a of appearances) totals.set(a.key, (totals.get(a.key) ?? 0) + 1);

  const perWindow = windows.map((window) => {
    const currentFrom = addDays(asOf, -(window.days - 1));
    const previousTo = addDays(currentFrom, -1);
    const previousFrom = addDays(previousTo, -(window.days - 1));
    const current = countsInRange(appearances, currentFrom, asOf);
    const previous = countsInRange(appearances, previousFrom, previousTo);
    return {
      window,
      current,
      currentRanks: rankByCount(current),
      previousRanks: rankByCount(previous),
    };
  });

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => {
      const counts: Record<string, number> = {};
      const movements: Record<string, RankMovement> = {};
      for (const { window, current, currentRanks, previousRanks } of perWindow) {
        counts[window.id] = current.get(key) ?? 0;
        const now = currentRanks.get(key);
        const before = previousRanks.get(key);
        if (now === undefined) {
          // Absent from the current window. Not "fallen to last" — they
          // simply aren't in this window's ranking at all, and inventing a
          // position for them would manufacture movement.
          movements[window.id] = { delta: null, isNew: false };
        } else if (before === undefined) {
          movements[window.id] = { delta: null, isNew: true };
        } else {
          movements[window.id] = { delta: before - now, isNew: false };
        }
      }
      return { key, total, counts, movements };
    });
}
