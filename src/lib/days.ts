import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  commuteEnum,
  days,
  dayTypeEnum,
  workLocationEnum,
  workoutDataSourceEnum,
  workouts,
  workoutSets,
  type CommuteOption,
  type DayType,
  type WorkLocationOption,
  type WorkoutDataSource,
} from "@/db/schema";

export type WorkoutSetPayload = {
  setNumber: number;
  reps: number | null;
  weightLbs: number | null;
  durationSeconds: number | null;
};

export type WorkoutPayload = {
  exercise: string;
  subtype: string;
  dataSource: WorkoutDataSource;
  location: string | null;
  durationMinutes: number | null;
  details: Record<string, unknown> | null;
  sets: WorkoutSetPayload[];
};

export type DayPayload = {
  date: string;
  distanceWalkedKm: number | null;
  coffees: number | null;
  sick: boolean | null;
  sleepTime: string | null;
  wakeTime: string | null;
  wakeCrossedMidnight: boolean;
  sleepLocationType: string | null;
  sleepLocationSubtype: string | null;
  napMinutes: number | null;
  happiness: number | null;
  happinessReason: string | null;
  journal: string | null;
  dayType: DayType | null;
  productivity: number | null;
  workDurationMinutes: number | null;
  workLocation: WorkLocationOption[];
  commute: CommuteOption[];
  workouts: WorkoutPayload[];
};

/** Reads one day's full record — the scalar day row plus its workouts and
 * their sets — straight from the database. Used both by the API route and
 * directly by the server-rendered day page (no self-fetch over HTTP). */
export async function loadDay(date: string): Promise<DayPayload> {
  const db = getDb();

  const [dayRow] = await db.select().from(days).where(eq(days.date, date));
  const workoutRows = await db
    .select()
    .from(workouts)
    .where(eq(workouts.date, date))
    .orderBy(asc(workouts.sortOrder), asc(workouts.id));

  const workoutIds = workoutRows.map((w) => w.id);
  const setRows = workoutIds.length
    ? await db
        .select()
        .from(workoutSets)
        .where(inArray(workoutSets.workoutId, workoutIds))
        .orderBy(asc(workoutSets.setNumber))
    : [];

  const setsByWorkout = new Map<number, typeof setRows>();
  for (const set of setRows) {
    const list = setsByWorkout.get(set.workoutId) ?? [];
    list.push(set);
    setsByWorkout.set(set.workoutId, list);
  }

  return {
    date,
    distanceWalkedKm: dayRow?.distanceWalkedKm ?? null,
    coffees: dayRow?.coffees ?? null,
    sick: dayRow?.sick ?? null,
    sleepTime: dayRow?.sleepTime ?? null,
    wakeTime: dayRow?.wakeTime ?? null,
    wakeCrossedMidnight: dayRow?.wakeCrossedMidnight ?? false,
    sleepLocationType: dayRow?.sleepLocationType ?? null,
    sleepLocationSubtype: dayRow?.sleepLocationSubtype ?? null,
    napMinutes: dayRow?.napMinutes ?? null,
    happiness: dayRow?.happiness ?? null,
    happinessReason: dayRow?.happinessReason ?? null,
    journal: dayRow?.journal ?? null,
    dayType: dayRow?.dayType ?? null,
    productivity: dayRow?.productivity ?? null,
    workDurationMinutes: dayRow?.workDurationMinutes ?? null,
    workLocation: dayRow?.workLocation ?? [],
    commute: dayRow?.commute ?? [],
    workouts: workoutRows.map((w) => ({
      exercise: w.exercise,
      subtype: w.subtype,
      dataSource: w.dataSource,
      location: w.location,
      durationMinutes: w.durationMinutes,
      details: w.details ?? null,
      sets: (setsByWorkout.get(w.id) ?? []).map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weightLbs: s.weightLbs,
        durationSeconds: s.durationSeconds,
      })),
    })),
  };
}

const DAY_TYPES = new Set<string>(dayTypeEnum.enumValues);
const WORK_LOCATIONS = new Set<string>(workLocationEnum.enumValues);
const COMMUTES = new Set<string>(commuteEnum.enumValues);
const DATA_SOURCES = new Set<string>(workoutDataSourceEnum.enumValues);

function isPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

export type ValidationResult =
  | { ok: true; value: DayPayload }
  | { ok: false; error: string };

/** Validates and normalizes a raw request body into a DayPayload. This is
 * the source of truth for what's acceptable — the entry form has its own
 * client-side hints (e.g. highlighting that commute is required), but this
 * is what actually enforces it. */
export function validateDayPayload(date: string, body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (b.happiness !== null && b.happiness !== undefined && !isPercent(b.happiness)) {
    return { ok: false, error: "Happiness must be between 0 and 100" };
  }
  if (b.productivity !== null && b.productivity !== undefined && !isPercent(b.productivity)) {
    return { ok: false, error: "Productivity must be between 0 and 100" };
  }
  if (b.dayType && !DAY_TYPES.has(b.dayType as string)) {
    return { ok: false, error: "Invalid day type" };
  }

  const workLocation = Array.isArray(b.workLocation) ? (b.workLocation as string[]) : [];
  for (const loc of workLocation) {
    if (!WORK_LOCATIONS.has(loc)) {
      return { ok: false, error: `Invalid work location: ${loc}` };
    }
  }

  const commute = Array.isArray(b.commute) ? (b.commute as string[]) : [];
  for (const c of commute) {
    if (!COMMUTES.has(c)) {
      return { ok: false, error: `Invalid commute option: ${c}` };
    }
  }

  // Mirrors the legacy form's *intended* behavior (its error message said
  // commute was required whenever work happened anywhere other than home,
  // but its actual check only looked for the literal value "office" — a
  // real code/message mismatch). This enforces what the message promised.
  const awayFromHome = workLocation.some((loc) => loc !== "home");
  if (awayFromHome && commute.length === 0) {
    return {
      ok: false,
      error: "Commute is required when work location is away from home",
    };
  }

  const workoutsInput = Array.isArray(b.workouts)
    ? (b.workouts as Record<string, unknown>[])
    : [];
  const parsedWorkouts: WorkoutPayload[] = [];
  for (const w of workoutsInput) {
    const exercise = typeof w.exercise === "string" ? w.exercise.trim() : "";
    const subtype = typeof w.subtype === "string" ? w.subtype.trim() : "";
    if (!exercise) return { ok: false, error: "Every workout needs an exercise name" };
    if (!subtype) return { ok: false, error: "Every workout needs a subtype" };

    const dataSource = DATA_SOURCES.has(w.dataSource as string)
      ? (w.dataSource as WorkoutDataSource)
      : "manual";

    const setsInput = Array.isArray(w.sets) ? (w.sets as Record<string, unknown>[]) : [];
    parsedWorkouts.push({
      exercise,
      subtype,
      dataSource,
      location: typeof w.location === "string" && w.location.trim() ? w.location.trim() : null,
      durationMinutes: typeof w.durationMinutes === "number" ? w.durationMinutes : null,
      details: w.details && typeof w.details === "object" ? (w.details as Record<string, unknown>) : null,
      sets: setsInput.map((s, i) => ({
        setNumber: typeof s.setNumber === "number" ? s.setNumber : i + 1,
        reps: typeof s.reps === "number" ? s.reps : null,
        weightLbs: typeof s.weightLbs === "number" ? s.weightLbs : null,
        durationSeconds: typeof s.durationSeconds === "number" ? s.durationSeconds : null,
      })),
    });
  }

  return {
    ok: true,
    value: {
      date,
      distanceWalkedKm: typeof b.distanceWalkedKm === "number" ? b.distanceWalkedKm : null,
      coffees: typeof b.coffees === "number" ? b.coffees : null,
      sick: typeof b.sick === "boolean" ? b.sick : null,
      sleepTime: typeof b.sleepTime === "string" && b.sleepTime ? b.sleepTime : null,
      wakeTime: typeof b.wakeTime === "string" && b.wakeTime ? b.wakeTime : null,
      wakeCrossedMidnight: Boolean(b.wakeCrossedMidnight),
      sleepLocationType:
        typeof b.sleepLocationType === "string" && b.sleepLocationType ? b.sleepLocationType : null,
      sleepLocationSubtype:
        typeof b.sleepLocationSubtype === "string" && b.sleepLocationSubtype
          ? b.sleepLocationSubtype
          : null,
      napMinutes: typeof b.napMinutes === "number" ? b.napMinutes : null,
      happiness: typeof b.happiness === "number" ? b.happiness : null,
      happinessReason:
        typeof b.happinessReason === "string" && b.happinessReason ? b.happinessReason : null,
      journal: typeof b.journal === "string" && b.journal ? b.journal : null,
      dayType: (b.dayType as DayType) || null,
      productivity: typeof b.productivity === "number" ? b.productivity : null,
      workDurationMinutes: typeof b.workDurationMinutes === "number" ? b.workDurationMinutes : null,
      workLocation: workLocation as WorkLocationOption[],
      commute: commute as CommuteOption[],
      workouts: parsedWorkouts,
    },
  };
}

/**
 * Upserts the day row and replaces its workouts/sets wholesale.
 *
 * Not wrapped in a DB transaction: the neon-http driver (chosen so
 * src/lib/db.ts can create its client lazily and stay friendly to
 * Vercel's serverless/edge functions) only supports single-round-trip
 * batches, not interactive transactions — and a batch can't thread a
 * freshly-inserted workout's generated id into its sets insert. So this is
 * a sequence of awaited statements, not one atomic unit. A save that fails
 * partway through could leave workouts/sets out of sync with the day row.
 * Acceptable for a single-writer personal app — the legacy app had the same
 * kind of no-consistency-guarantee fan-out on every save (a day doc write
 * plus several independent `views/{field}` writes) — but worth knowing if
 * this ever needs to become multi-writer or safety-critical.
 */
export async function saveDay(payload: DayPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date: payload.date,
      distanceWalkedKm: payload.distanceWalkedKm,
      coffees: payload.coffees,
      sick: payload.sick,
      sleepTime: payload.sleepTime,
      wakeTime: payload.wakeTime,
      wakeCrossedMidnight: payload.wakeCrossedMidnight,
      sleepLocationType: payload.sleepLocationType,
      sleepLocationSubtype: payload.sleepLocationSubtype,
      napMinutes: payload.napMinutes,
      happiness: payload.happiness,
      happinessReason: payload.happinessReason,
      journal: payload.journal,
      dayType: payload.dayType,
      productivity: payload.productivity,
      workDurationMinutes: payload.workDurationMinutes,
      workLocation: payload.workLocation,
      commute: payload.commute,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        distanceWalkedKm: payload.distanceWalkedKm,
        coffees: payload.coffees,
        sick: payload.sick,
        sleepTime: payload.sleepTime,
        wakeTime: payload.wakeTime,
        wakeCrossedMidnight: payload.wakeCrossedMidnight,
        sleepLocationType: payload.sleepLocationType,
        sleepLocationSubtype: payload.sleepLocationSubtype,
        napMinutes: payload.napMinutes,
        happiness: payload.happiness,
        happinessReason: payload.happinessReason,
        journal: payload.journal,
        dayType: payload.dayType,
        productivity: payload.productivity,
        workDurationMinutes: payload.workDurationMinutes,
        workLocation: payload.workLocation,
        commute: payload.commute,
        updatedAt: new Date(),
      },
    });

  // Cascades to workout_sets via the FK's onDelete: "cascade".
  await db.delete(workouts).where(eq(workouts.date, payload.date));

  for (let i = 0; i < payload.workouts.length; i++) {
    const w = payload.workouts[i];
    const [inserted] = await db
      .insert(workouts)
      .values({
        date: payload.date,
        sortOrder: i,
        exercise: w.exercise,
        subtype: w.subtype,
        dataSource: w.dataSource,
        location: w.location,
        durationMinutes: w.durationMinutes,
        details: w.details,
      })
      .returning({ id: workouts.id });

    if (w.sets.length > 0) {
      await db.insert(workoutSets).values(
        w.sets.map((s) => ({
          workoutId: inserted.id,
          setNumber: s.setNumber,
          reps: s.reps,
          weightLbs: s.weightLbs,
          durationSeconds: s.durationSeconds,
        }))
      );
    }
  }

  return loadDay(payload.date);
}
