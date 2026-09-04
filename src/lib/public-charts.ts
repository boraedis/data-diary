// Public-safe chart data for the landing page's charts section (#12/#84).
// Same rule as src/lib/public-profile.ts: each function is its own narrow,
// explicit query — never a passthrough of src/lib/charts.ts's own
// functions, even though the shape (and the underlying SQL) is
// intentionally the same for the curated chart types below. That keeps
// this module self-contained: charts.ts can grow new fields or new chart
// types without anything here changing unless someone deliberately adds
// it. The three chart types here (weight, happiness trend, sleep) involve
// no "subs", no address, no relationships, and no per-day free text, so
// nothing needs masking beyond picking the right columns in the first
// place — see PUBLIC_CHART_TYPES in src/lib/public-content.ts for the
// curated list this corresponds to.
import { asc, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days } from "@/db/schema";
import { groupByPeriod, summarizePeriods } from "@/lib/viz/bin";

// Widened alongside charts.ts's own WeightMetricsPoint (issue #117
// follow-up) — body fat % and muscle mass are body-composition data, not
// address/relationship/free-text, so per this file's own header comment
// they don't need masking, just picking the right columns (explicit
// product call: expose them here rather than defaulting to "weight only"
// just because that's what shipped first).
export type PublicWeightPoint = {
  date: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
};

export async function getPublicWeightData(): Promise<PublicWeightPoint[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, weightKg: days.weightKg, bodyFatPercent: days.bodyFatPercent, muscleMassKg: days.muscleMassKg })
    .from(days)
    .where(or(isNotNull(days.weightKg), isNotNull(days.bodyFatPercent), isNotNull(days.muscleMassKg)))
    .orderBy(asc(days.date));
  return rows;
}

export type PublicMonthlyHappiness = {
  month: string; // "YYYY-MM"
  avg: number;
  count: number;
  min: number;
  max: number;
};

export async function getPublicHappinessTrendData(): Promise<PublicMonthlyHappiness[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));

  const buckets = groupByPeriod(rows, "month", (r) => r.date);
  const summaries = summarizePeriods(buckets, (r) => r.happiness as number);
  return buckets.map((bucket, i) => {
    const values = bucket.items.map((r) => r.happiness as number);
    return {
      month: bucket.key,
      avg: summaries[i].avg,
      count: summaries[i].count,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  });
}

export type PublicSleepDay = { date: string; durationMinutes: number };

function hhmmToMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export async function getPublicSleepData(): Promise<PublicSleepDay[]> {
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

  const out: PublicSleepDay[] = [];
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
