import { eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, people, profileSettings } from "@/db/schema";
import { addDays, toDateString } from "@/lib/date";
import {
  HOME_LOGGED_SCORE,
  HOME_SCORE_COLUMNS,
  scoreDay,
  type DayColumn,
} from "@/lib/expected-fields";

// The columns the home score reads, as a drizzle selection. Built from the
// registry so a section added there is selected here without a second edit;
// the cast is what Object.fromEntries can't infer on its own.
const SCORE_SELECTION = Object.fromEntries(
  HOME_SCORE_COLUMNS.map((c) => [c, days[c]])
) as { [K in DayColumn]: (typeof days)[K] };

export type RecentDay = {
  date: string;
  score: number; // 0-10 sections filled, see HOME_SECTIONS in expected-fields.ts
};

export type BirthdayEntry = {
  name: string;
  birthdate: string;
  daysUntil: number;
  turnsAge: number;
};

export type HomeDashboardData = {
  daysLogged: number;
  percentOfLifeLogged: number | null;
  daysBehind: number;
  recentDays: RecentDay[]; // 14 days, oldest first
  upcomingBirthdays: BirthdayEntry[]; // top 7 by days-until
};

function computeUpcomingBirthdays(
  rows: { name: string; birthdate: string }[],
  today: string,
  limit: number
): BirthdayEntry[] {
  const [ty, tm, td] = today.split("-").map(Number);
  const todayTs = new Date(ty, tm - 1, td).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;

  return rows
    .map((p) => {
      const [by, bm, bd] = p.birthdate.split("-").map(Number);
      let nextYear = ty;
      let nextTs = new Date(nextYear, bm - 1, bd).getTime();
      if (nextTs < todayTs) {
        nextYear++;
        nextTs = new Date(nextYear, bm - 1, bd).getTime();
      }
      const daysUntil = Math.round((nextTs - todayTs) / msPerDay);
      return { name: p.name, birthdate: p.birthdate, daysUntil, turnsAge: nextYear - by };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit);
}

export async function getHomeDashboardData(): Promise<HomeDashboardData> {
  const db = getDb();
  const today = toDateString(new Date());
  // 90 days of history: enough to compute daysBehind without being expensive
  const since90 = addDays(today, -89);

  const [loggedResult, settingsRows, recentRows, birthdayRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(days)
      .where(
        or(
          isNotNull(days.happiness),
          isNotNull(days.sleepTime),
          isNotNull(days.distanceWalkedKm),
          isNotNull(days.productivity),
          isNotNull(days.positivePerson1Id)
        )
      ),
    db
      .select({ birthdate: profileSettings.birthdate })
      .from(profileSettings)
      .where(eq(profileSettings.id, 1)),
    // Satellite tables (workouts, entertainment, …) aren't joined: the
    // home score is deliberately `days`-only, see HOME_SECTIONS.
    db
      .select({
        date: days.date,
        ...SCORE_SELECTION,
      })
      .from(days)
      .where(gte(days.date, since90)),
    db
      .select({ name: people.name, birthdate: people.birthdate })
      .from(people)
      .where(isNotNull(people.birthdate)),
  ]);

  const daysLogged = Number(loggedResult[0]?.n ?? 0);
  const birthdate = settingsRows[0]?.birthdate ?? null;
  const rowByDate = new Map(recentRows.map((r) => [r.date, r]));

  // % of life logged
  let percentOfLifeLogged: number | null = null;
  if (birthdate) {
    const [by, bm, bd] = birthdate.split("-").map(Number);
    const [ty2, tm2, td2] = today.split("-").map(Number);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceBirth = Math.round(
      (new Date(ty2, tm2 - 1, td2).getTime() - new Date(by, bm - 1, bd).getTime()) / msPerDay
    );
    if (daysSinceBirth > 0) {
      percentOfLifeLogged = (daysLogged / daysSinceBirth) * 100;
    }
  }

  // Days behind: consecutive days from yesterday backward that score
  // under HOME_LOGGED_SCORE (half the sections)
  let daysBehind = 0;
  let checkDate = addDays(today, -1);
  while (checkDate >= since90) {
    const row = rowByDate.get(checkDate);
    if (scoreDay(row ?? null) >= HOME_LOGGED_SCORE) break;
    daysBehind++;
    checkDate = addDays(checkDate, -1);
  }

  // 14 most recent days, oldest first (index 0 = 13 days ago, 13 = today)
  const recentDays: RecentDay[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    const row = rowByDate.get(date);
    recentDays.push({ date, score: scoreDay(row ?? null) });
  }

  const upcomingBirthdays = computeUpcomingBirthdays(
    birthdayRows.filter((r): r is { name: string; birthdate: string } => r.birthdate !== null),
    today,
    7
  );

  return { daysLogged, percentOfLifeLogged, daysBehind, recentDays, upcomingBirthdays };
}
