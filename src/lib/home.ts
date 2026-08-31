import { eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, people, profileSettings } from "@/db/schema";
import { addDays, toDateString } from "@/lib/date";

export type RecentDay = {
  date: string;
  score: number; // 0-10 sections filled
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

// 10 sections checked from `days` own columns. Satellite tables
// (workouts, entertainment, movies, etc.) aren't joined here — one
// batch query for 90 days is much cheaper than joining 4+ tables, and
// the core columns give a meaningful "how complete is this day" signal.
// The 50%-threshold (score >= 5) drives daysBehind.
function scoreDay(row: {
  happiness: number | null;
  sleepTime: string | null;
  distanceWalkedKm: number | null;
  coffees: number | null;
  sick: boolean | null;
  productivity: number | null;
  workDurationMinutes: number | null;
  positivePerson1Id: number | null;
  place1Id: number | null;
  subA: number | null;
  weightKg: number | null;
  phoneUsageMinutes: number | null;
  laptopUsageMinutes: number | null;
  instagramFollowers: number | null;
}): number {
  let score = 0;
  if (row.happiness !== null) score++;
  if (row.sleepTime !== null) score++;
  if (row.distanceWalkedKm !== null || row.coffees !== null || row.sick !== null) score++;
  if (row.productivity !== null || row.workDurationMinutes !== null) score++;
  if (row.positivePerson1Id !== null) score++;
  if (row.place1Id !== null) score++;
  if (row.subA !== null) score++;
  if (row.weightKg !== null) score++;
  if (row.phoneUsageMinutes !== null || row.laptopUsageMinutes !== null) score++;
  if (row.instagramFollowers !== null) score++;
  return score;
}

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
    db
      .select({
        date: days.date,
        happiness: days.happiness,
        sleepTime: days.sleepTime,
        distanceWalkedKm: days.distanceWalkedKm,
        coffees: days.coffees,
        sick: days.sick,
        productivity: days.productivity,
        workDurationMinutes: days.workDurationMinutes,
        positivePerson1Id: days.positivePerson1Id,
        place1Id: days.place1Id,
        subA: days.subA,
        weightKg: days.weightKg,
        phoneUsageMinutes: days.phoneUsageMinutes,
        laptopUsageMinutes: days.laptopUsageMinutes,
        instagramFollowers: days.instagramFollowers,
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

  // Days behind: consecutive days from yesterday backward where score < 5
  let daysBehind = 0;
  let checkDate = addDays(today, -1);
  while (checkDate >= since90) {
    const row = rowByDate.get(checkDate);
    const score = row ? scoreDay(row) : 0;
    if (score >= 5) break;
    daysBehind++;
    checkDate = addDays(checkDate, -1);
  }

  // 14 most recent days, oldest first (index 0 = 13 days ago, 13 = today)
  const recentDays: RecentDay[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    const row = rowByDate.get(date);
    recentDays.push({ date, score: row ? scoreDay(row) : 0 });
  }

  const upcomingBirthdays = computeUpcomingBirthdays(
    birthdayRows.filter((r): r is { name: string; birthdate: string } => r.birthdate !== null),
    today,
    7
  );

  return { daysLogged, percentOfLifeLogged, daysBehind, recentDays, upcomingBirthdays };
}
