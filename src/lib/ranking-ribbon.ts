import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { bookRankingEvents, books, movieRankingEvents, movies } from "@/db/schema";
import { replayRanking, type RankingEventRow } from "@/lib/ranking-history";

// The ranking ribbon (#222's `top_movie_ribbon`, generalised to every ranked
// list): how a top-10 changed from year to year, rebuilt from the delta log
// (#546) by replaying it at each year's end.

export type RankingList = "movie" | "book";

/** A logged change, plus the title to label its item with. */
export type RibbonEvent = RankingEventRow & { title: string };

export type RibbonColumn = { label: string; at: Date };

export type RibbonSeries = {
  id: string;
  label: string;
  /** Rank at each column, 1 = best, or null when the item wasn't in the
   * top 10 then. Same length as the columns. */
  ranks: (number | null)[];
};

export type Ribbon = {
  columns: RibbonColumn[];
  /** In first-appearance order (earliest column, then best rank there), so
   * an item keeps its place in the order — and its colour — as history grows. */
  series: RibbonSeries[];
  /** When the log starts, "YYYY-MM-DD": nothing is known before it. */
  since: string | null;
};

export const RIBBON_SIZE = 10;

/** Every event for one list, oldest first. Ties on `at` (one save's events
 * share a clock tick) break by id, which is the order they were written —
 * what `replayRanking` needs. */
export async function getRankingEvents(list: RankingList): Promise<RibbonEvent[]> {
  const db = getDb();
  const rows =
    list === "movie"
      ? await db
          .select({
            itemId: movieRankingEvents.movieId,
            title: movies.title,
            kind: movieRankingEvents.kind,
            fromRank: movieRankingEvents.fromRank,
            toRank: movieRankingEvents.toRank,
            at: movieRankingEvents.at,
          })
          .from(movieRankingEvents)
          .innerJoin(movies, eq(movies.id, movieRankingEvents.movieId))
          .orderBy(asc(movieRankingEvents.at), asc(movieRankingEvents.id))
      : await db
          .select({
            itemId: bookRankingEvents.bookId,
            title: books.title,
            kind: bookRankingEvents.kind,
            fromRank: bookRankingEvents.fromRank,
            toRank: bookRankingEvents.toRank,
            at: bookRankingEvents.at,
          })
          .from(bookRankingEvents)
          .innerJoin(books, eq(books.id, bookRankingEvents.bookId))
          .orderBy(asc(bookRankingEvents.at), asc(bookRankingEvents.id));
  return rows;
}

/**
 * One column per calendar year (UTC) from the first logged event to `now`:
 * each past year is the list as it stood at that year's end, and the current
 * year is the list as of `now`. Only items that were in the top
 * `RIBBON_SIZE` in at least one column get a series.
 *
 * Years rather than finer steps because the chart is "how my favourites
 * shifted across years"; a column for a year in which nothing changed simply
 * repeats the last one, which reads as ribbons running level. Pure, so it's
 * testable without a database.
 */
export function buildRibbon(events: RibbonEvent[], now: Date = new Date()): Ribbon {
  if (events.length === 0) return { columns: [], series: [], since: null };

  const firstYear = events[0].at.getUTCFullYear();
  const lastYear = now.getUTCFullYear();
  const columns: RibbonColumn[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const isCurrent = year === lastYear;
    columns.push({
      label: isCurrent ? "Now" : String(year),
      at: isCurrent ? now : new Date(Date.UTC(year + 1, 0, 1) - 1),
    });
  }

  const titles = new Map<number, string>();
  for (const e of events) titles.set(e.itemId, e.title);

  const lists = columns.map((c) => replayRanking(events, c.at).slice(0, RIBBON_SIZE));

  const order: number[] = [];
  const seen = new Set<number>();
  for (const list of lists) {
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }

  const series = order.map((id) => ({
    id: String(id),
    label: titles.get(id) as string,
    ranks: lists.map((list) => {
      const i = list.indexOf(id);
      return i === -1 ? null : i + 1;
    }),
  }));

  return { columns, series, since: events[0].at.toISOString().slice(0, 10) };
}
