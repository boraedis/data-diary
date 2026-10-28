import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  bookReadingSessions,
  days,
  entertainmentEntries,
  gameSessions,
  movieWatches,
  sportsWatches,
  tvEpisodeWatches,
  workouts,
} from "@/db/schema";
import { addDays } from "@/lib/date";
import { columnsFor, type DayColumn, type DaySnapshot, type SatelliteDomain } from "@/lib/expected-fields";
import { JUDGE_LAG_DAYS, SCAN_FIELDS, type ScanInput } from "./types";

/**
 * Loads everything the detectors need in two queries: the `days` columns
 * the scan's fields read, for every date, and a per-date row count for
 * each satellite domain. The full history, not a window, because
 * expectations and a domain's usual rhythm are both learned from it.
 * At one row per day that's a few thousand rows.
 */

// Each domain's per-date count. Music isn't here because the scan skips
// it (see SCAN_FIELDS), and it's the one domain keyed by a timestamp
// rather than a `date` column.
const DOMAIN_COUNTS: Record<Exclude<SatelliteDomain, "music">, SQL> = {
  workouts: sql`select ${workouts.date} as date, count(*) as n from ${workouts} group by 1`,
  entertainment: sql`select ${entertainmentEntries.date} as date, count(*) as n from ${entertainmentEntries} group by 1`,
  movies: sql`select ${movieWatches.date} as date, count(*) as n from ${movieWatches} group by 1`,
  // TV watches can be undated (backfilled "watched at some point"); those
  // say nothing about any one day.
  tv: sql`select ${tvEpisodeWatches.date} as date, count(*) as n from ${tvEpisodeWatches} where ${tvEpisodeWatches.date} is not null group by 1`,
  books: sql`select ${bookReadingSessions.date} as date, count(*) as n from ${bookReadingSessions} group by 1`,
  games: sql`select ${gameSessions.date} as date, count(*) as n from ${gameSessions} group by 1`,
  sports: sql`select ${sportsWatches.date} as date, count(*) as n from ${sportsWatches} group by 1`,
};

const DAY_SELECTION = Object.fromEntries(
  columnsFor(SCAN_FIELDS).map((c) => [c, days[c]])
) as { [K in DayColumn]: (typeof days)[K] };

export async function loadScanInput(today: string): Promise<ScanInput> {
  const db = getDb();
  const domainUnion = sql.join(
    Object.entries(DOMAIN_COUNTS).map(
      ([domain, query]) => sql`select ${domain}::text as domain, c.date::text as date, c.n::int as n from (${query}) c`
    ),
    sql` union all `
  );

  const [dayRows, countRows] = await Promise.all([
    db.select({ date: days.date, ...DAY_SELECTION }).from(days),
    db.execute<{ domain: SatelliteDomain; date: string; n: number }>(domainUnion),
  ]);

  const byDate = new Map<string, DaySnapshot>(
    dayRows.map(({ date, ...day }) => [date, { date, day, satellites: {} }])
  );
  for (const { domain, date, n } of countRows.rows) {
    // Every satellite row references days.date, so the row is there.
    const snapshot = byDate.get(date);
    if (snapshot) snapshot.satellites![domain] = Number(n);
  }

  return {
    snapshots: [...byDate.values()],
    lastJudgedDate: addDays(today, -JUDGE_LAG_DAYS),
  };
}
