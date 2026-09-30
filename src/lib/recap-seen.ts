import { sql } from "drizzle-orm";
import { days, recapSeen } from "@/db/schema";
import { todayDateString } from "@/lib/date";
import { getDb } from "@/lib/db";
import {
  isPeriodPublished,
  monthPeriod,
  periodPublishDate,
  periodUnit,
  yearPeriod,
  type RecapPeriod,
} from "@/lib/recap";

// The in-app "new recap ready" badge (#518, epic #130 follow-up). "Ready"
// is exactly `isPeriodPublished` from the publish gate (#517) — there is no
// second definition of it here. What this module adds is the other half:
// which published recaps the owner hasn't opened yet.
//
// Deliberately in-app only. No cron, email or push: the badge is computed
// on render from the data and the seen-set, so there's nothing to schedule.

/** The key a period is stored under: "2026" for a year, "2026-03" for a
 * month. Null for any other window — only calendar years and months are
 * badged, because those are the only periods with an index to badge. */
export function recapPeriodKey(period: RecapPeriod): string | null {
  const unit = periodUnit(period);
  if (unit === "year") return period.start.slice(0, 4);
  if (unit === "month") return period.start.slice(0, 7);
  return null;
}

/** The inverse of `recapPeriodKey`, or null for anything that isn't a
 * well-formed year ("2026") or month ("2026-03") key. */
export function periodFromRecapKey(key: string): RecapPeriod | null {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  if (match[2] === undefined) return yearPeriod(year);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? monthPeriod(year, month) : null;
}

export type UnseenRecaps = {
  /** Years with a published, unopened recap. */
  years: number[];
  /** Months ("YYYY-MM") with a published, unopened recap. */
  months: string[];
};

/**
 * Which published recaps are still unopened.
 *
 * - A period with no logged days is never badged: "new: a recap of
 *   nothing" is noise, and its page would only say so.
 * - A period published on or before `baseline` counts as seen (see the
 *   `recapSeen` table comment), so turning this feature on doesn't badge a
 *   decade of history.
 * - Years and months are judged independently — a year is its own recap,
 *   published on its own clock, and is badged until it is itself opened.
 *   Every unseen period is listed individually, so what's new is never
 *   hidden behind a count.
 */
export function findUnseenRecaps({
  monthCounts,
  seenKeys,
  baseline,
  today,
}: {
  /** Logged-day count per "YYYY-MM". */
  monthCounts: Map<string, number>;
  seenKeys: ReadonlySet<string>;
  baseline: string;
  today: string;
}): UnseenRecaps {
  const isUnseen = (period: RecapPeriod, key: string) =>
    isPeriodPublished(period, today) &&
    periodPublishDate(period) > baseline &&
    !seenKeys.has(key);

  const months: string[] = [];
  const yearsWithData = new Set<number>();
  for (const [key, loggedDays] of monthCounts) {
    if (loggedDays <= 0) continue;
    const period = periodFromRecapKey(key);
    if (period === null) continue;
    yearsWithData.add(Number(key.slice(0, 4)));
    if (isUnseen(period, key)) months.push(key);
  }

  const years = [...yearsWithData]
    .filter((year) => isUnseen(yearPeriod(year), String(year)))
    .sort((a, b) => b - a);
  return { years, months: months.sort().reverse() };
}

/** Total badged periods — Home shows this next to the Recap link. */
export function countUnseen(unseen: UnseenRecaps): number {
  return unseen.years.length + unseen.months.length;
}

/**
 * Reads the seen-state and works out what's unopened.
 *
 * The first call ever creates the singleton row, stamping `baselineDate`
 * with today. That's a write on a read path, but it happens exactly once,
 * is idempotent (`on conflict do nothing`), and is the simplest way to get
 * "the day this feature turned on" without a seed migration.
 */
export async function getUnseenRecaps(today: string = todayDateString()): Promise<UnseenRecaps> {
  const db = getDb();
  await db.insert(recapSeen).values({ id: 1, baselineDate: today }).onConflictDoNothing();

  const [[state], rows] = await Promise.all([
    db
      .select({ baselineDate: recapSeen.baselineDate, seenKeys: recapSeen.seenKeys })
      .from(recapSeen),
    db
      .select({
        month: sql<string>`to_char(${days.date}, 'YYYY-MM')`,
        loggedDays: sql<number>`count(*)::int`,
      })
      .from(days)
      .groupBy(sql`to_char(${days.date}, 'YYYY-MM')`),
  ]);

  return findUnseenRecaps({
    monthCounts: new Map(rows.map((row) => [row.month, row.loggedDays])),
    seenKeys: new Set(state?.seenKeys ?? []),
    baseline: state?.baselineDate ?? today,
    today,
  });
}

/**
 * Records that a recap was opened. Returns false — and records nothing —
 * for a malformed key or a period that isn't published yet, so a preview
 * of an in-progress month can't pre-mark its real recap as seen.
 */
export async function markRecapSeen(key: string, today: string = todayDateString()): Promise<boolean> {
  const period = periodFromRecapKey(key);
  if (period === null || !isPeriodPublished(period, today)) return false;

  const db = getDb();
  await db
    .insert(recapSeen)
    .values({ id: 1, baselineDate: today, seenKeys: [key] })
    .onConflictDoUpdate({
      target: recapSeen.id,
      set: {
        // Set semantics in one statement: append only when absent, so two
        // tabs marking the same recap can't duplicate it.
        seenKeys: sql`case when ${key} = any(${recapSeen.seenKeys}) then ${recapSeen.seenKeys} else array_append(${recapSeen.seenKeys}, ${key}) end`,
        updatedAt: new Date(),
      },
    });
  return true;
}
