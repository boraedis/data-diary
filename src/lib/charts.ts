import { asc, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, people, places, workouts } from "@/db/schema";

// Phase 4, first batch: five chart data-fetchers, each backed entirely by
// domains already migrated (Phases 1-3) — see REBUILD_PLAN.md for the full
// list of legacy charts and why these five were picked first (data-ready,
// and five genuinely different D3 chart archetypes). Every function returns
// plain serializable data (no Date objects, no Drizzle row wrappers) since
// it's passed from a server component straight into a client chart
// component as a prop.

// --- Happiness histogram ---------------------------------------------------

/** Every recorded happiness value (0-100), oldest first. Binning is left to
 * the chart component (d3.bin has better judgment about bucket width than a
 * pre-aggregated count would) rather than done here. */
export async function getHappinessHistogramData(): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ happiness: days.happiness })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));
  return rows.map((r) => r.happiness as number);
}

// --- Weight scroller ---------------------------------------------------

export type WeightPoint = { date: string; weightKg: number };

/** Every recorded weight, oldest first — feeds a zoomable line chart via a
 * brush on a mini overview strip (the legacy "scroller" pattern). */
export async function getWeightScrollerData(): Promise<WeightPoint[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, weightKg: days.weightKg })
    .from(days)
    .where(isNotNull(days.weightKg))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, weightKg: r.weightKg as number }));
}

// --- Sleep calendar ---------------------------------------------------

export type SleepDay = { date: string; durationMinutes: number };

function hhmmToMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Sleep duration per day, derived from sleepTime/wakeTime + the explicit
 * wakeCrossedMidnight flag (see schema.ts's comment on that column — the
 * legacy app computed this client-side and then discarded it, so duration
 * across midnight is only recoverable going forward, not for old data that
 * predates the flag... except the flag is backfilled by the Phase 3
 * migration script from the same wake<sleep heuristic, so it's populated
 * for historical data too). Days missing either time are skipped rather
 * than guessed at. */
export async function getSleepCalendarData(): Promise<SleepDay[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      sleepTime: days.sleepTime,
      wakeTime: days.wakeTime,
      wakeCrossedMidnight: days.wakeCrossedMidnight,
    })
    .from(days)
    .where(sql`${days.sleepTime} is not null and ${days.wakeTime} is not null`)
    .orderBy(asc(days.date));

  const out: SleepDay[] = [];
  for (const r of rows) {
    const sleepMin = hhmmToMinutes(r.sleepTime as string);
    const wakeMin = hhmmToMinutes(r.wakeTime as string);
    if (sleepMin === null || wakeMin === null) continue;
    const durationMinutes = wakeMin - sleepMin + (r.wakeCrossedMidnight ? 24 * 60 : 0);
    if (durationMinutes <= 0 || durationMinutes > 20 * 60) continue; // guard against bad data
    out.push({ date: r.date, durationMinutes });
  }
  return out;
}

// --- Weight + workout volume combo ---------------------------------------------------

export type WorkoutMonth = { month: string; count: number }; // month = "YYYY-MM"

export type GymWeightComboData = {
  weight: WeightPoint[];
  workoutsByMonth: WorkoutMonth[];
};

/** Weight (line) alongside workout frequency (bars, one per calendar month —
 * daily workout counts would be too sparse/spiky to read as bars over a
 * multi-year range, monthly is the legacy chart's effective resolution
 * too). Two independently-shaped series sharing one time x-axis and two
 * y-axes, ported from the legacy app's bespoke `LineBarChart` in
 * gym-weight_chart.js. */
export async function getGymWeightComboData(): Promise<GymWeightComboData> {
  const db = getDb();
  const [weightRows, workoutDates] = await Promise.all([
    db
      .select({ date: days.date, weightKg: days.weightKg })
      .from(days)
      .where(isNotNull(days.weightKg))
      .orderBy(asc(days.date)),
    db.select({ date: workouts.date }).from(workouts).orderBy(asc(workouts.date)),
  ]);

  const monthCounts = new Map<string, number>();
  for (const { date } of workoutDates) {
    const month = date.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  const workoutsByMonth = [...monthCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  return {
    weight: weightRows.map((r) => ({ date: r.date, weightKg: r.weightKg as number })),
    workoutsByMonth,
  };
}

// --- Place leaderboard ---------------------------------------------------

export type PlaceLeaderboardEntry = { name: string; value: number };

/** Ranks places by how often they were logged in a day's two place slots,
 * weighting slot 1 double slot 2 — the exact scheme the legacy
 * `location_leaderboard` chart used (`places[mens.place1].value += 2`,
 * `+= 1` for place2). The legacy chart then grouped results into a
 * metro/category hierarchy for a nested table; that enrichment isn't in
 * this schema yet (see REBUILD_PLAN.md), so this is the flat top-15
 * ranking underneath it — still the real, meaningful part. */
export async function getPlaceLeaderboardData(limit = 15): Promise<PlaceLeaderboardEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      name: places.name,
      value: sql<number>`
        coalesce(sum(case when ${days.place1Id} = ${places.id} then 2 else 0 end), 0)
        + coalesce(sum(case when ${days.place2Id} = ${places.id} then 1 else 0 end), 0)
      `.as("value"),
    })
    .from(places)
    .innerJoin(
      days,
      sql`${days.place1Id} = ${places.id} or ${days.place2Id} = ${places.id}`,
    )
    .groupBy(places.id, places.name)
    .orderBy(desc(sql`value`))
    .limit(limit);

  return rows.map((r) => ({ name: r.name, value: Number(r.value) }));
}

// --- Happiness averager ---------------------------------------------------

export type MonthlyAverage = { month: string; avg: number; count: number }; // month = "YYYY-MM"

/** Monthly average happiness (plus the sample size behind each point, so the
 * chart can size markers by how many days actually fed each average — a
 * month with 2 entries and a month with 30 shouldn't look equally
 * confident). The legacy "Averager" pattern (functions/views/vis/charts/
 * happiness_averager.js) bins by day-type too; that's left out here since
 * it'd need a second grouping dimension this first pass doesn't have a UI
 * for yet. */
export async function getHappinessAveragerData(): Promise<MonthlyAverage[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));

  const byMonth = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const cur = byMonth.get(month) ?? { sum: 0, count: 0 };
    cur.sum += r.happiness as number;
    cur.count += 1;
    byMonth.set(month, cur);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { sum, count }]) => ({ month, avg: sum / count, count }));
}

// --- Subs small multiples ---------------------------------------------------

/** One row per day that has at least one of the 9 subs filled in; `values`
 * is aligned index-for-index with SUB_NAMES from `@/lib/days` (the single
 * source of truth for sub ordering — reused here rather than re-declared,
 * same as every other place in the app that touches subs). */
export type SubsSeries = { date: string; values: (number | null)[] };

export async function getSubsScrollerData(): Promise<SubsSeries[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      subA: days.subA,
      subW: days.subW,
      subC: days.subC,
      subL: days.subL,
      subNi: days.subNi,
      subNO: days.subNO,
      subAd: days.subAd,
      subD: days.subD,
      subK: days.subK,
    })
    .from(days)
    .where(
      sql`${days.subA} is not null or ${days.subW} is not null or ${days.subC} is not null
        or ${days.subL} is not null or ${days.subNi} is not null or ${days.subNO} is not null
        or ${days.subAd} is not null or ${days.subD} is not null or ${days.subK} is not null`,
    )
    .orderBy(asc(days.date));

  // Order matches SUB_NAMES = ["A", "W", "C", "L", "Ni", "NO", "Ad", "D", "K"].
  return rows.map((r) => ({
    date: r.date,
    values: [r.subA, r.subW, r.subC, r.subL, r.subNi, r.subNO, r.subAd, r.subD, r.subK],
  }));
}

// --- People network ---------------------------------------------------

export type NetworkNode = { id: number; name: string; count: number };
export type NetworkEdge = { source: number; target: number; weight: number };
export type PeopleNetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[] };

/** A co-occurrence graph: nodes are people, sized by how many days they were
 * logged in any of the 10 person slots; edges connect two people who were
 * both logged on the same day, weighted by how often that's happened.
 * Computed in JS rather than SQL — the 10 slots are 10 separate FK columns
 * (see schema.ts), not rows in a table, so there's nothing to GROUP BY;
 * unpivoting them per day and tallying pairs is simplest done here, and
 * `days` is only ~3-4k rows, cheap to pull whole. Capped to the `maxNodes`
 * most-mentioned people — the legacy app didn't cap this at all, but a
 * force-directed layout with (in this diary's case) 700 catalog people
 * would be unreadable regardless of screen size. */
export async function getPeopleNetworkData(maxNodes = 40): Promise<PeopleNetworkData> {
  const db = getDb();
  const rows = await db
    .select({
      p1: days.positivePerson1Id,
      p2: days.positivePerson2Id,
      p3: days.positivePerson3Id,
      p4: days.positivePerson4Id,
      p5: days.positivePerson5Id,
      p6: days.positivePerson6Id,
      p7: days.positivePerson7Id,
      n1: days.negativePerson1Id,
      n2: days.negativePerson2Id,
      n3: days.negativePerson3Id,
    })
    .from(days);

  const appearanceCount = new Map<number, number>();
  const coOccurrence = new Map<string, number>(); // key `${lowerId}-${higherId}`

  for (const row of rows) {
    const ids = [row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7, row.n1, row.n2, row.n3].filter(
      (id): id is number => id !== null,
    );
    const unique = [...new Set(ids)];
    for (const id of unique) {
      appearanceCount.set(id, (appearanceCount.get(id) ?? 0) + 1);
    }
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [a, b] = unique[i] < unique[j] ? [unique[i], unique[j]] : [unique[j], unique[i]];
        const key = `${a}-${b}`;
        coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
      }
    }
  }

  const topIds = [...appearanceCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNodes)
    .map(([id]) => id);
  const topSet = new Set(topIds);

  if (topIds.length === 0) return { nodes: [], edges: [] };

  const peopleRows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, topIds));
  const nameById = new Map<number, string>(
    peopleRows.map((p): [number, string] => [p.id, p.name]),
  );

  const nodes: NetworkNode[] = topIds.map((id) => ({
    id,
    name: nameById.get(id) ?? "?",
    count: appearanceCount.get(id) ?? 0,
  }));

  const edges: NetworkEdge[] = [];
  for (const [key, weight] of coOccurrence) {
    const [aStr, bStr] = key.split("-");
    const a = Number(aStr);
    const b = Number(bStr);
    if (topSet.has(a) && topSet.has(b)) edges.push({ source: a, target: b, weight });
  }

  return { nodes, edges };
}
