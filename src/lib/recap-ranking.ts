import { addDays } from "@/lib/date";
import type { RecapPeriod } from "@/lib/recap";
import { getRankingEvents, type RankingList, type RibbonEvent } from "@/lib/ranking-ribbon";
import { replayRanking } from "@/lib/ranking-history";

// How the movie and book rankings moved during a recap period (#660).
//
// The recap already names the best-ranked film or book *watched* in the
// period (`topRankedMovie`); this is the other question — what happened to
// the list itself. It's built on the ranking history log (#546), replayed at
// the period's two edges, which is the same point-in-time definition
// `ranking.ts` uses for leaderboard movement: standing as it was at a
// moment, compared with standing at another.
//
// **When it can say anything.** The log has no history before it shipped;
// the list as it then stood was seeded as `add` events at one instant. A
// period that starts before that instant would see every ranked title as
// "new this period", so movement is only reported for periods starting on
// or after the day the log began — before that the state is `unavailable`
// and says since when, rather than inventing a year of changes. A period
// with the log running but no events in it is `available` with nothing to
// show, which is a true answer ("you didn't touch your ranking").
//
// **Timezone.** Event times are instants, periods are calendar dates; a
// period's edges are taken as UTC midnights. An edit made within a few hours
// of a boundary can land on the other side of it, which is the same
// tolerance the publish gate accepts (`isPeriodPublished`).

/** Titles shown for new entries before the rest are counted. */
export const MAX_LISTED_ENTRIES = 3;

export type RankingClimber = { title: string; from: number; to: number; places: number };
export type RankingEntry = { title: string; rank: number };

export type RankingMovement =
  | { status: "unavailable"; since: string | null }
  | {
      status: "available";
      /** Biggest gain in places among titles ranked at both edges. Null when
       * nobody rose. */
      climber: RankingClimber | null;
      /** Titles ranked at the end that weren't at the start, best first. */
      entries: RankingEntry[];
      /** All new entries, of which `entries` lists the best few. */
      entryCount: number;
    };

function startOfPeriod(period: RecapPeriod): Date {
  return new Date(`${period.start}T00:00:00.000Z`);
}

function endOfPeriod(period: RecapPeriod): Date {
  // One millisecond before the next day's midnight, so an event stamped at
  // exactly the boundary belongs to the next period, not both.
  return new Date(new Date(`${addDays(period.end, 1)}T00:00:00.000Z`).getTime() - 1);
}

/** The pure half: movement over one period from a list's full event log
 * (oldest first, as `getRankingEvents` returns it). */
export function summarizeRankingMovement(events: RibbonEvent[], period: RecapPeriod): RankingMovement {
  const first = events[0];
  const start = startOfPeriod(period);
  if (first === undefined || first.at > start) {
    return { status: "unavailable", since: first ? first.at.toISOString().slice(0, 10) : null };
  }

  const titles = new Map(events.map((event) => [event.itemId, event.title]));
  const rankMap = (ids: number[]) => new Map(ids.map((id, i) => [id, i + 1]));
  // Just before the period opens, so an event at exactly its first instant counts inside.
  const before = rankMap(replayRanking(events, new Date(start.getTime() - 1)));
  const after = rankMap(replayRanking(events, endOfPeriod(period)));

  let climber: RankingClimber | null = null;
  const entries: RankingEntry[] = [];
  for (const [id, to] of after) {
    const from = before.get(id);
    const title = titles.get(id) ?? "";
    if (from === undefined) {
      entries.push({ title, rank: to });
      continue;
    }
    const places = from - to;
    if (places > 0 && (climber === null || places > climber.places || (places === climber.places && to < climber.to))) {
      climber = { title, from, to, places };
    }
  }
  entries.sort((a, b) => a.rank - b.rank);
  return { status: "available", climber, entries: entries.slice(0, MAX_LISTED_ENTRIES), entryCount: entries.length };
}

export type RecapRankings = Record<RankingList, RankingMovement>;

export async function getRecapRankings(period: RecapPeriod): Promise<RecapRankings> {
  const [movie, book] = await Promise.all([getRankingEvents("movie"), getRankingEvents("book")]);
  return {
    movie: summarizeRankingMovement(movie, period),
    book: summarizeRankingMovement(book, period),
  };
}
