// Public-safe chart data for the landing page's charts section (#12/#84).
// Same rule as src/lib/public-profile.ts: each function is its own narrow,
// explicit query — never a passthrough of src/lib/charts.ts's own
// functions, even though the shape (and the underlying SQL) is
// intentionally the same for the curated chart types below. That keeps
// this module self-contained: charts.ts can grow new fields or new chart
// types without anything here changing unless someone deliberately adds
// it. Most chart types here involve no "subs", no address, no
// relationships, and no per-day free text, so nothing needs masking
// beyond picking the right columns in the first place. The one deliberate
// exception is daily happiness's `reason` field below — explicit call by
// the app owner to expose it, not an oversight of the "no free text"
// default every other chart here still follows — see
// PUBLIC_CHART_TYPES in src/lib/public-content.ts for the curated list
// this corresponds to.
import { asc, isNotNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { days } from "@/db/schema";
import {
  getAdminRegionVisitData,
  getCountryVisitData,
  getExerciseWorkoutRows,
  getPlaceHierarchyData,
  getUsCountyVisitData,
  getUsStateVisitData,
  type AdminRegionVisitData,
  type CountryVisitEntry,
  type DailyValue,
  type DeviceDay,
  type ExerciseWorkoutRow,
  type PlaceHierarchyRow,
  type SleepNight,
  type UsCountyVisitData,
  type UsStateVisitEntry,
} from "@/lib/charts";
import { getMusicLeaderboardData, type MusicMode } from "@/lib/leaderboards/listens";
import type { LeaderboardRow } from "@/lib/leaderboards/rows";
import {
  getUnloggedTravelCodes,
  getUnloggedTravelDetails,
  type UnloggedTravelDetail,
  type UnloggedTravelKind,
} from "@/lib/unlogged-travel";

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

export type PublicHappinessDay = { date: string; happiness: number };

/** Raw-daily happiness — bucketing moved client-side into `TrendExplorer`
 * (period picker + work-day split both need to re-bucket on demand), same
 * move `src/lib/charts.ts`'s own private `getHappinessTrendData` made. No
 * day-type here: the work-day split stays private-only, same reasoning
 * `SleepCalendarChart`'s naps toggle is private-only — see that chart's own
 * comment on `SleepCalendarPoint`. */
export async function getPublicHappinessTrendData(): Promise<PublicHappinessDay[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, happiness: r.happiness as number }));
}

// `reason` included — explicit call by the app owner (see this file's own
// header comment) to expose happiness's per-day free text publicly,
// unlike every other chart in this module.
export type PublicHappinessScrollerPoint = { date: string; happiness: number; reason: string | null };

/** Raw-daily counterpart to getPublicHappinessTrendData's monthly
 * bucketing above — issue #117 follow-up's happiness scroller, public
 * side. No occupation/residence/relationship/age regions here (those stay
 * private-only, same call as the weight scroller's own). */
export async function getPublicHappinessScrollerData(): Promise<PublicHappinessScrollerPoint[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness, reason: days.happinessReason })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, happiness: r.happiness as number, reason: r.reason }));
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

/** Public counterpart to getSleepNightsData's SleepNight[] (#453) — same
 * duration derivation as getPublicSleepData above, plus napMinutes, which
 * SleepTrendChart also plots. `locationType`/`dayType`/`bedtimeMinutes`
 * are filled with masked placeholder values rather than the real columns:
 * SleepTrendChart never reads them (only sleep-hist and sleep-hours do),
 * so this keeps SleepNight's shape without threading sleep location or
 * day-type — both private-only — through the public boundary. */
export async function getPublicSleepTrendData(): Promise<SleepNight[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      sleepTime: days.sleepTime,
      wakeTime: days.wakeTime,
      wakeCrossedMidnight: days.wakeCrossedMidnight,
      napMinutes: days.napMinutes,
    })
    .from(days)
    .where(sql`${days.sleepTime} is not null and ${days.wakeTime} is not null`)
    .orderBy(asc(days.date));

  const out: SleepNight[] = [];
  for (const r of rows) {
    const sleepMin = hhmmToMinutes(r.sleepTime as string);
    const wakeMin = hhmmToMinutes(r.wakeTime as string);
    if (sleepMin === null || wakeMin === null) continue;
    const durationMinutes = wakeMin - sleepMin + (r.wakeCrossedMidnight ? 24 * 60 : 0);
    if (durationMinutes <= 0 || durationMinutes > 20 * 60) continue;
    out.push({
      date: r.date,
      durationMinutes,
      napMinutes: r.napMinutes,
      locationType: null,
      dayType: null,
      bedtimeMinutes: 0,
    });
  }
  return out;
}

/** Every logged value of one nullable numeric `days` column, oldest first
 * — the public counterpart to charts.ts's private `dailyValuesOf`, kept
 * as its own copy rather than an import: that helper isn't exported (see
 * this module's own header on why nothing here passes through the
 * private layer's internals), and a single-column daily read has nothing
 * to mask beyond picking the column. */
async function publicDailyValuesOf(column: AnyPgColumn): Promise<DailyValue[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, value: column })
    .from(days)
    .where(isNotNull(column))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
}

export function getPublicCoffeeDailyData(): Promise<DailyValue[]> {
  return publicDailyValuesOf(days.coffees);
}

export function getPublicDistanceDailyData(): Promise<DailyValue[]> {
  return publicDailyValuesOf(days.distanceWalkedKm);
}

/** Public counterpart to getDeviceUsageData — phone/laptop minutes only.
 * `instagramMinutes` is always null: DeviceUsageChart's own Screen Time
 * Mix only plots the two devices (Instagram is deliberately not a third
 * category there — see that chart's own comment on why it'd double-count
 * against Phone), so nulling it here rather than fetching it keeps
 * Instagram usage off the public boundary without needing a narrower
 * type than DeviceDay. */
export async function getPublicDeviceUsageData(): Promise<DeviceDay[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, phoneMinutes: days.phoneUsageMinutes, laptopMinutes: days.laptopUsageMinutes })
    .from(days)
    .where(or(isNotNull(days.phoneUsageMinutes), isNotNull(days.laptopUsageMinutes)))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ ...r, instagramMinutes: null }));
}

// --- Reused private aggregators (#453) -------------------------------------
//
// The functions below call charts.ts's/leaderboards/listens.ts's own
// aggregators directly rather than re-deriving them here, as a deliberate,
// documented exception to this module's "own narrow query, never a
// passthrough" rule: each one is a non-trivial multi-query/JS aggregation
// (country/state resolution via idPath/namePath walks, the place tree,
// music's ranking pipeline), and every one of their return types already
// contains zero fields this module would need to mask — no address/
// lat-lng, no private people, no free text, just country/state/place
// names and counts, or artist/song names (public figures, not private
// people — see #453's own comment on why this doesn't trip the "no naming
// people" rule the way people-* charts would). Re-deriving these queries
// here would only add drift risk with no added safety, unlike
// getPublicSleepTrendData above, which *does* have real fields to mask
// and so gets its own query.

export function getPublicCountryVisitData(): Promise<CountryVisitEntry[]> {
  return getCountryVisitData();
}

export function getPublicUsStateVisitData(): Promise<UsStateVisitEntry[]> {
  return getUsStateVisitData();
}

/** Enables World's country -> state/admin-region drill-down publicly
 * (#453 follow-up) — subdivision names and day counts only, no
 * coordinates, same safety profile as the country/state tiers above. */
export function getPublicAdminRegionVisitData(): Promise<AdminRegionVisitData> {
  return getAdminRegionVisitData();
}

/** Enables US Heatmap's state -> county/metro drill-down publicly (#453
 * follow-up) — county names/FIPS and day counts only, no coordinates. */
export function getPublicUsCountyVisitData(): Promise<UsCountyVisitData> {
  return getUsCountyVisitData();
}

/** Unlogged-travel membership (#453 follow-up) — which countries/counties
 * were travelled to or through, with no logged day. Codes/FIPS and
 * membership only; safe as-is (same shape `getPublicCountryVisitData`
 * etc. already expose). See getPublicUnloggedTravelDetails below for the
 * one field this module masks out of the *details* variant. */
export function getPublicUnloggedTravelCodes(kind: UnloggedTravelKind): Promise<Set<string>> {
  return getUnloggedTravelCodes(kind);
}

/** Per-code `firstVisited` only — `note` is free text an owner could put
 * anything in (a companion's name, a private reason for the trip), so
 * unlike this file's other reused aggregators, this one *does* mask a
 * field rather than reuse UnloggedTravelDetail whole. Only used for the
 * tooltip's "first visited" line; nothing here reads `note`. */
export async function getPublicUnloggedTravelDetails(
  kind: UnloggedTravelKind,
): Promise<Map<string, UnloggedTravelDetail>> {
  const details = await getUnloggedTravelDetails(kind);
  return new Map([...details].map(([code, detail]) => [code, { firstVisited: detail.firstVisited, note: null }]));
}

export function getPublicPlaceHierarchyData(): Promise<PlaceHierarchyRow[]> {
  return getPlaceHierarchyData();
}

export function getPublicExerciseWorkoutRows(): Promise<ExerciseWorkoutRow[]> {
  return getExerciseWorkoutRows();
}

export function getPublicMusicLeaderboardData(mode: MusicMode): Promise<LeaderboardRow[]> {
  return getMusicLeaderboardData(mode);
}
