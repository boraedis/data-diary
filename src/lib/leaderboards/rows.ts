import type { RankedItem, RankMovement, RankWindow } from "@/lib/ranking";

// The one row shape every leaderboard page hands to the client (#115).
//
// Every domain — places, people, music, podcasts, entertainment, sports,
// exercise — reduces to the same thing: a ranked name, a main number, an
// optional secondary count, and where it stood a week/month/year ago. So
// each domain module only has to say *what* it ranks and how to label it;
// the table, the pickers and the movement arrows are shared.
//
// Deliberately compact, because it crosses the server/client boundary as
// JSON and music's song mode is ~17k rows: movement travels as the rank
// held at each window's start (`previousRanks`) rather than as full
// `RankMovement` objects, since delta and "new" both follow from that and
// the current rank. `movementOf` rebuilds the object on the client.

export type LeaderboardRow = {
  key: string;
  rank: number;
  name: string;
  /** Muted second line under the name — a song's artist, a team's league. */
  detail: string | null;
  /** Text for the optional context column (a place's path, an entry's
   * type). Only shown when the page's config names a context header. */
  context: string | null;
  /** Cell colour: tints the context column when there is one, otherwise
   * the name — a country, a tag, a genre group, a team. */
  color: string | null;
  /** The main stat — mentions, days, hours, an impact score. */
  value: number;
  /** Unweighted occurrences — plays, sessions, games, days. */
  count: number;
  /** Rank at each window's start, in `windows` order; null = not ranked
   * yet. Null as a whole where movement doesn't apply (the recap). */
  previousRanks: (number | null)[] | null;
  /** Main stat gained inside each window, in `windows` order. */
  gained: number[] | null;
};

export type LeaderboardMeta = {
  name: string;
  detail?: string | null;
  context?: string | null;
  color?: string | null;
};

/** Values are rounded before they cross to the client — full float
 * precision on 17k rows is payload with no reader. Three decimals keeps
 * hours exact to the second-ish and impact scores to far past display. */
function trim(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function toLeaderboardRows(
  items: RankedItem[],
  windows: RankWindow[],
  meta: (key: string) => LeaderboardMeta,
): LeaderboardRow[] {
  return items.map((item) => {
    const m = meta(item.key);
    return {
      key: item.key,
      rank: item.rank,
      name: m.name,
      detail: m.detail ?? null,
      context: m.context ?? null,
      color: m.color ?? null,
      value: trim(item.total),
      count: item.occurrences,
      previousRanks: windows.map((w) => item.movements[w.id]?.previousRank ?? null),
      gained: windows.map((w) => trim(item.counts[w.id] ?? 0)),
    };
  });
}

/** The full movement for window `index`, rebuilt from the compact row. */
export function movementOf(row: LeaderboardRow, index: number): RankMovement | null {
  if (!row.previousRanks) return null;
  const previousRank = row.previousRanks[index] ?? null;
  return previousRank === null
    ? { delta: null, isNew: true, previousRank: null }
    : { delta: previousRank - row.rank, isNew: false, previousRank };
}

/** How the main stat and gains are formatted. A name rather than a
 * function, because the config is built in a server component and only
 * plain data can cross to the client table. */
export type LeaderboardValueFormat = "count" | "hours" | "score";

/** Which columns a leaderboard shows, and what they're called. */
export type LeaderboardColumns = {
  nameHeader: string;
  /** Omit for no context column. */
  contextHeader?: string;
  contextDescription?: string;
  valueHeader: string;
  valueDescription?: string;
  valueFormat: LeaderboardValueFormat;
  /** Omit for no secondary count column. */
  countHeader?: string;
  countDescription?: string;
  /** What the main stat is, in a sentence: "hours gained". Used in the
   * movement columns' header tooltips. */
  gainedNoun: string;
};

/** Ties share the better rank, same rule as `src/lib/ranking.ts` — for
 * builders that rank without movement (the recap). */
export function competitionRanks(values: number[]): number[] {
  return values.map((v) => values.findIndex((other) => other === v) + 1);
}
