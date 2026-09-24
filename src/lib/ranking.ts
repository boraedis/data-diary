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
export type RankWindow = {
  id: string;
  label: string;
  days: number;
  /** How the window reads in a sentence, for hover labels: "Up 3 places
   * since a week ago". */
  since?: string;
};

/**
 * The week / month / year windows every leaderboard uses, so the people and
 * places tables (and whatever joins them) agree on what "a month ago" means.
 * 31 rather than 30 so a month window always reaches the same date last
 * month, never the day after it.
 */
export const STANDARD_RANK_WINDOWS: RankWindow[] = [
  { id: "week", label: "Week", days: 7, since: "a week ago" },
  { id: "month", label: "Month", days: 31, since: "a month ago" },
  { id: "year", label: "Year", days: 365, since: "a year ago" },
];

/**
 * One appearance of `key` on `date`. `weight` defaults to 1 — people count
 * one per day, but places use legacy's slot weighting (the day's first place
 * counts double the second), and movement has to be computed on the same
 * weighted totals the table is sorted by or the two would disagree.
 */
export type RankAppearance = { key: string; date: string; weight?: number };

export type RankMovement = {
  /** Positions gained since that point in time — positive is upward (a
   * numerically smaller rank). Null when the person hadn't appeared at all
   * yet, so there was no position to move from. */
  delta: number | null;
  /** First appeared inside this window: they weren't in the ranking at
   * that point, which is a different statement from "unchanged". */
  isNew: boolean;
  /** The rank held at that point in time, for a hover label ("was 7th") —
   * null exactly when `isNew`. */
  previousRank: number | null;
};

export type RankedItem = {
  key: string;
  /** Current rank, ties sharing the better one (see `rankByCount`). */
  rank: number;
  /** Appearances (weighted, where weights were given) across the whole
   * history — what the table is sorted by. */
  total: number;
  /** Unweighted appearances across the whole history — sessions, plays,
   * days — for a secondary column beside a weighted total (hours, score). */
  occurrences: number;
  /** Appearances (weighted) gained inside each window. */
  counts: Record<string, number>;
  movements: Record<string, RankMovement>;
};

/**
 * One key's cumulative standing now and at the start of each window —
 * everything movement needs, without the individual appearances.
 *
 * `computeRankings` builds these from appearances, which suits the small
 * domains (a few thousand days or sessions). The large ones — music is
 * ~100k listens — aggregate straight to snapshots in SQL instead
 * (`sum(...) filter (where played_at <= cutoff)`), so the rows never leave
 * the database; both then share `rankSnapshots` and can't disagree about
 * what movement means.
 */
export type RankSnapshot = {
  key: string;
  total: number;
  occurrences: number;
  /** Cumulative (weighted) total as it stood at each window's start, keyed
   * by window id. Null when the key had no appearances yet by then — "not
   * ranked", which is different from ranked on zero. */
  before: Record<string, number | null>;
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

/**
 * Current rank, gains and point-in-time movement from snapshots, sorted by
 * total, highest first.
 */
export function rankSnapshots(snapshots: RankSnapshot[], windows: RankWindow[]): RankedItem[] {
  const nowRanks = rankByCount(new Map(snapshots.map((s) => [s.key, s.total])));
  const thenRanks = windows.map((window) => {
    const then = new Map<string, number>();
    for (const s of snapshots) {
      const before = s.before[window.id];
      if (before !== null && before !== undefined) then.set(s.key, before);
    }
    return rankByCount(then);
  });

  return [...snapshots]
    .sort((a, b) => b.total - a.total)
    .map((s) => {
      const rank = nowRanks.get(s.key) as number;
      const counts: Record<string, number> = {};
      const movements: Record<string, RankMovement> = {};
      windows.forEach((window, i) => {
        counts[window.id] = s.total - (s.before[window.id] ?? 0);
        const before = thenRanks[i].get(s.key);
        // Not in the ranking at that point at all, so there is no position
        // to have moved from. Treating "absent" as "last" would report an
        // enormous rise for anything recently discovered.
        movements[window.id] =
          before === undefined
            ? { delta: null, isNew: true, previousRank: null }
            : { delta: before - rank, isNew: false, previousRank: before };
      });
      return { key: s.key, rank, total: s.total, occurrences: s.occurrences, counts, movements };
    });
}

/**
 * Totals and point-in-time rank movement per key.
 *
 * `asOf` anchors every window — pass the latest logged date rather than
 * today, so a gap in logging doesn't shift every window past the end of
 * the data and report movement that is really just absence. Appearances
 * after `asOf` are ignored.
 */
export function computeRankings(
  appearances: RankAppearance[],
  asOf: string,
  windows: RankWindow[],
): RankedItem[] {
  const cutoffs = windows.map((window) => addDays(asOf, -window.days));
  const byKey = new Map<string, RankSnapshot>();
  for (const a of appearances) {
    if (a.date > asOf) continue;
    let snapshot = byKey.get(a.key);
    if (!snapshot) {
      snapshot = { key: a.key, total: 0, occurrences: 0, before: {} };
      for (const window of windows) snapshot.before[window.id] = null;
      byKey.set(a.key, snapshot);
    }
    const weight = a.weight ?? 1;
    snapshot.total += weight;
    snapshot.occurrences += 1;
    windows.forEach((window, i) => {
      if (a.date <= cutoffs[i]) snapshot.before[window.id] = (snapshot.before[window.id] ?? 0) + weight;
    });
  }
  return rankSnapshots([...byKey.values()], windows);
}
