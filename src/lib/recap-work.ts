import { and, asc, gte, lte } from "drizzle-orm";
import { days } from "@/db/schema";
import { getDb } from "@/lib/db";
import { buildWorkLeaderboard, type Occupation } from "@/lib/leaderboards/work";
import type { LeaderboardRow } from "@/lib/leaderboards/rows";
import { listProfileOccupations } from "@/lib/profile";
import type { RecapPeriod } from "@/lib/recap";
import { summarizeDaily, type DatedValue, type RecapDailyMetric } from "@/lib/recap-body";
import { toRecapPicks } from "@/lib/recap-entertainment";
import type { WorkDay } from "@/lib/work";

// The recap's work & screen time section (#530, slice 4 of #521).
//
// **Two clocks for work.** `dayType = "work"` goes back years; hours and
// productivity have only been logged since 2026-05-11 (`work.ts` header).
// So anything that needs history — days worked, which job they went to —
// reads `dayType`, and the two newer columns are summarised over the days
// that actually recorded them, gated on `MIN_DAYS_FOR_AVERAGE` like every
// other average. That gate *is* the explicit gate the issue asks for: a
// 2024 recap has zero logged hours and reads "not enough data" (or drops
// the card, when neither period logged any), never a confident 0h. A
// hard-coded "tracked since" date was considered and not used — the
// coverage count already says exactly that, and it keeps saying it if old
// days are ever backfilled with hours.
//
// **Days worked is a total, gated on typed days.** A count is honest at any
// coverage (`MIN_DAYS_FOR_TOTAL`), but "0 days worked" over a period where
// no day carried a day type at all is the confident zero again. So the
// coverage number for that card is days with *any* day type logged, not
// the work days themselves.
//
// **Screen time** follows the body section's rule (`recap-body.ts`): a
// per-logged-day average leads, because a total over a sparsely-logged
// period understates it. Instagram minutes are a *subset* of phone minutes
// (`DeviceDay` in charts.ts, #326), so they're reported as their own
// average and as a share of phone time — never added on top of it.
//
// Like body & habits, none of this has a direction the recap should assert
// (more hours, less phone time), so everything downstream is neutral.

export type RecapWork = {
  /** Days typed `work`. */
  daysWorked: number;
  priorDaysWorked: number;
  /** Days with any day type — the coverage number days-worked gates on. */
  daysTyped: number;
  priorDaysTyped: number;
  /** Hours per day *worked*: averaged over days that logged more than zero
   * minutes. A recorded 0 on a day off is a true fact about that day but
   * not about a working day, and averaging it in would make the number
   * depend on how often days off happened to get a 0 typed in. */
  hours: RecapDailyMetric;
  /** The self-rated 0–100 score, averaged over days that logged one. */
  productivity: RecapDailyMetric;
  /** Days worked per job, location and commute — the job leaderboard's own
   * builder (`buildWorkLeaderboard`) run over the period, so the recap and
   * /charts/job-leaderboard can't disagree about who a day is credited
   * to. Top `PICKS_SIZE` by rank, movement dropped (`toRecapPicks`). */
  jobs: LeaderboardRow[];
  locations: LeaderboardRow[];
  commute: LeaderboardRow[];
};

export type RecapInstagramFollowers = {
  /** The last reading in each period: a running total, so the period's
   * level is where it ended, not its average. */
  last: DatedValue | null;
  priorLast: DatedValue | null;
  /** First reading in the period, for the start → end detail line. */
  first: DatedValue | null;
  daysLogged: number;
  priorDaysLogged: number;
};

export type RecapScreenTime = {
  /** Minutes per logged day. */
  phone: RecapDailyMetric;
  laptop: RecapDailyMetric;
  instagram: RecapDailyMetric;
  /** Instagram minutes ÷ phone minutes, over days that logged both — null
   * when none did. Same-day pairing so a stretch of phone-only days (all of
   * pre-2025) can't dilute the share. */
  instagramShare: number | null;
  followers: RecapInstagramFollowers;
};

/** The row this module reads: work fields plus the device columns. */
export type RecapWorkDayRow = WorkDay & {
  phoneMinutes: number | null;
  laptopMinutes: number | null;
  instagramMinutes: number | null;
  instagramFollowers: number | null;
};

function inPeriod(date: string, period: RecapPeriod): boolean {
  return date >= period.start && date <= period.end;
}

function column(
  rows: RecapWorkDayRow[],
  pick: (row: RecapWorkDayRow) => number | null,
): DatedValue[] {
  return rows.flatMap((row) => {
    const value = pick(row);
    return value === null ? [] : [{ date: row.date, value }];
  });
}

/** Exported and pure: every rule in the header above lives here. */
export function summarizeWork(
  rows: RecapWorkDayRow[],
  occupations: Occupation[],
  period: RecapPeriod,
  prior: RecapPeriod,
): RecapWork {
  const current = rows.filter((row) => inPeriod(row.date, period));
  const previous = rows.filter((row) => inPeriod(row.date, prior));
  const worked = (list: RecapWorkDayRow[]) => list.filter((row) => row.dayType === "work").length;
  const typed = (list: RecapWorkDayRow[]) => list.filter((row) => row.dayType !== null).length;

  return {
    daysWorked: worked(current),
    priorDaysWorked: worked(previous),
    daysTyped: typed(current),
    priorDaysTyped: typed(previous),
    hours: summarizeDaily(
      column(rows, (row) => (row.minutes !== null && row.minutes > 0 ? row.minutes / 60 : null)),
      period,
      prior,
    ),
    productivity: summarizeDaily(column(rows, (row) => row.productivity), period, prior),
    jobs: toRecapPicks(buildWorkLeaderboard(current, occupations, "job", "days")),
    locations: toRecapPicks(buildWorkLeaderboard(current, occupations, "location", "days")),
    commute: toRecapPicks(buildWorkLeaderboard(current, occupations, "commute", "days")),
  };
}

/** `rows` must be ascending by date, as the query returns them. */
export function summarizeScreenTime(
  rows: RecapWorkDayRow[],
  period: RecapPeriod,
  prior: RecapPeriod,
): RecapScreenTime {
  let paired = { instagram: 0, phone: 0 };
  for (const row of rows) {
    if (!inPeriod(row.date, period) || row.instagramMinutes === null || row.phoneMinutes === null) continue;
    paired = { instagram: paired.instagram + row.instagramMinutes, phone: paired.phone + row.phoneMinutes };
  }

  const followers = column(rows, (row) => row.instagramFollowers);
  const currentFollowers = followers.filter((v) => inPeriod(v.date, period));
  const priorFollowers = followers.filter((v) => inPeriod(v.date, prior));

  return {
    phone: summarizeDaily(column(rows, (row) => row.phoneMinutes), period, prior),
    laptop: summarizeDaily(column(rows, (row) => row.laptopMinutes), period, prior),
    instagram: summarizeDaily(column(rows, (row) => row.instagramMinutes), period, prior),
    instagramShare: paired.phone > 0 ? paired.instagram / paired.phone : null,
    followers: {
      first: currentFollowers[0] ?? null,
      last: currentFollowers[currentFollowers.length - 1] ?? null,
      priorLast: priorFollowers[priorFollowers.length - 1] ?? null,
      daysLogged: currentFollowers.length,
      priorDaysLogged: priorFollowers.length,
    },
  };
}

export async function getRecapWork(
  period: RecapPeriod,
  prior: RecapPeriod,
): Promise<{ work: RecapWork; screenTime: RecapScreenTime }> {
  const db = getDb();
  const [raw, occupations] = await Promise.all([
    // One period-scoped read for both halves, rather than the all-time
    // `getWorkLeaderboardDays`/`getDeviceUsageData` the chart pages use:
    // everything here is a per-day column on `days`, so the window can go
    // straight into the WHERE.
    db
      .select({
        date: days.date,
        minutes: days.workDurationMinutes,
        productivity: days.productivity,
        locations: days.workLocation,
        commute: days.commute,
        dayType: days.dayType,
        happiness: days.happiness,
        phoneMinutes: days.phoneUsageMinutes,
        laptopMinutes: days.laptopUsageMinutes,
        instagramMinutes: days.instagramUsageMinutes,
        instagramFollowers: days.instagramFollowers,
      })
      .from(days)
      .where(and(gte(days.date, prior.start), lte(days.date, period.end)))
      .orderBy(asc(days.date)),
    listProfileOccupations(),
  ]);
  // `[]` for both a null and an empty array — see `WorkDay`'s comment on
  // why untracked years hold `{}`.
  const rows: RecapWorkDayRow[] = raw.map((r) => ({ ...r, locations: r.locations ?? [], commute: r.commute ?? [] }));

  return {
    work: summarizeWork(rows, occupations, period, prior),
    screenTime: summarizeScreenTime(rows, period, prior),
  };
}
