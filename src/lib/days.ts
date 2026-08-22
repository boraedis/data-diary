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

/** The full day record — every section's fields together. This is what
 * `loadDay` returns; it's used to render the day summary page (which needs
 * to see all sections at once to compute completion) and as the response
 * shape each section's save endpoint returns after saving. Individual
 * entry forms only read and submit their own section's slice (see the
 * Health/Sleep/Happiness/WorkPayload types below) — each section saves
 * independently, mirroring the legacy app's one-page-per-category forms. */
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

export type HealthPayload = {
  distanceWalkedKm: number | null;
  coffees: number | null;
  sick: boolean | null;
  workouts: WorkoutPayload[];
};

export type SleepPayload = {
  sleepTime: string | null;
  wakeTime: string | null;
  wakeCrossedMidnight: boolean;
  sleepLocationType: string | null;
  sleepLocationSubtype: string | null;
  napMinutes: number | null;
};

export type HappinessPayload = {
  happiness: number | null;
  happinessReason: string | null;
  journal: string | null;
  dayType: DayType | null;
};

export type WorkPayload = {
  productivity: number | null;
  workDurationMinutes: number | null;
  workLocation: WorkLocationOption[];
  commute: CommuteOption[];
};

/** Reads one day's full record — the scalar day row plus its workouts and
 * their sets — straight from the database. Used by the summary page, by
 * each section's own entry page (each just reads the slice it needs), and
 * returned by every save function below (so a save always hands back an
 * up-to-date full day). No self-fetch over HTTP anywhere. */
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

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWorkouts(input: unknown): Result<WorkoutPayload[]> {
  const workoutsInput = Array.isArray(input) ? (input as Record<string, unknown>[]) : [];
  const parsed: WorkoutPayload[] = [];
  for (const w of workoutsInput) {
    const exercise = typeof w.exercise === "string" ? w.exercise.trim() : "";
    const subtype = typeof w.subtype === "string" ? w.subtype.trim() : "";
    if (!exercise) return { ok: false, error: "Every workout needs an exercise name" };
    if (!subtype) return { ok: false, error: "Every workout needs a subtype" };

    const dataSource = DATA_SOURCES.has(w.dataSource as string)
      ? (w.dataSource as WorkoutDataSource)
      : "manual";

    const setsInput = Array.isArray(w.sets) ? (w.sets as Record<string, unknown>[]) : [];
    parsed.push({
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
  return { ok: true, value: parsed };
}

export function validateHealthPayload(body: unknown): Result<HealthPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const workoutsResult = parseWorkouts(b.workouts);
  if (!workoutsResult.ok) return workoutsResult;

  return {
    ok: true,
    value: {
      distanceWalkedKm: typeof b.distanceWalkedKm === "number" ? b.distanceWalkedKm : null,
      coffees: typeof b.coffees === "number" ? b.coffees : null,
      sick: typeof b.sick === "boolean" ? b.sick : null,
      workouts: workoutsResult.value,
    },
  };
}

export function validateSleepPayload(body: unknown): Result<SleepPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
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
    },
  };
}

export function validateHappinessPayload(body: unknown): Result<HappinessPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (b.happiness !== null && b.happiness !== undefined && !isPercent(b.happiness)) {
    return { ok: false, error: "Happiness must be between 0 and 100" };
  }
  if (b.dayType && !DAY_TYPES.has(b.dayType as string)) {
    return { ok: false, error: "Invalid day type" };
  }

  return {
    ok: true,
    value: {
      happiness: typeof b.happiness === "number" ? b.happiness : null,
      happinessReason:
        typeof b.happinessReason === "string" && b.happinessReason ? b.happinessReason : null,
      journal: typeof b.journal === "string" && b.journal ? b.journal : null,
      dayType: (b.dayType as DayType) || null,
    },
  };
}

export function validateWorkPayload(body: unknown): Result<WorkPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (b.productivity !== null && b.productivity !== undefined && !isPercent(b.productivity)) {
    return { ok: false, error: "Productivity must be between 0 and 100" };
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

  return {
    ok: true,
    value: {
      productivity: typeof b.productivity === "number" ? b.productivity : null,
      workDurationMinutes: typeof b.workDurationMinutes === "number" ? b.workDurationMinutes : null,
      workLocation: workLocation as WorkLocationOption[],
      commute: commute as CommuteOption[],
    },
  };
}

/**
 * Replaces a day's workouts (and their sets) wholesale with the given list.
 * Not wrapped in a DB transaction: the neon-http driver (chosen so
 * src/lib/db.ts can create its client lazily and stay friendly to
 * Vercel's serverless/edge functions) only supports single-round-trip
 * batches, not interactive transactions — and a batch can't thread a
 * freshly-inserted workout's generated id into its sets insert. So this is
 * a sequence of awaited statements, not one atomic unit. Acceptable for a
 * single-writer personal app — the legacy app had the same kind of
 * no-consistency-guarantee fan-out on every save.
 */
async function replaceWorkouts(date: string, list: WorkoutPayload[]): Promise<void> {
  const db = getDb();

  await db.delete(workouts).where(eq(workouts.date, date));

  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const [inserted] = await db
      .insert(workouts)
      .values({
        date,
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
}

// Each saveX function below is a partial upsert: it only touches its own
// section's columns on `days`, via onConflictDoUpdate's `set` listing just
// those columns. On a brand-new day (no existing row) every other column
// is nullable (or has a default), so inserting just one section's slice
// leaves the rest unset rather than clobbering them — this is what lets
// each section's entry page save completely independently of the others,
// mirroring the legacy app's one-page-per-category forms.

export async function saveHealth(date: string, value: HealthPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      distanceWalkedKm: value.distanceWalkedKm,
      coffees: value.coffees,
      sick: value.sick,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        distanceWalkedKm: value.distanceWalkedKm,
        coffees: value.coffees,
        sick: value.sick,
        updatedAt: new Date(),
      },
    });

  await replaceWorkouts(date, value.workouts);

  return loadDay(date);
}

export async function saveSleep(date: string, value: SleepPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      sleepTime: value.sleepTime,
      wakeTime: value.wakeTime,
      wakeCrossedMidnight: value.wakeCrossedMidnight,
      sleepLocationType: value.sleepLocationType,
      sleepLocationSubtype: value.sleepLocationSubtype,
      napMinutes: value.napMinutes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        sleepTime: value.sleepTime,
        wakeTime: value.wakeTime,
        wakeCrossedMidnight: value.wakeCrossedMidnight,
        sleepLocationType: value.sleepLocationType,
        sleepLocationSubtype: value.sleepLocationSubtype,
        napMinutes: value.napMinutes,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveHappiness(date: string, value: HappinessPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      happiness: value.happiness,
      happinessReason: value.happinessReason,
      journal: value.journal,
      dayType: value.dayType,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        happiness: value.happiness,
        happinessReason: value.happinessReason,
        journal: value.journal,
        dayType: value.dayType,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveWork(date: string, value: WorkPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      productivity: value.productivity,
      workDurationMinutes: value.workDurationMinutes,
      workLocation: value.workLocation,
      commute: value.commute,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        productivity: value.productivity,
        workDurationMinutes: value.workDurationMinutes,
        workLocation: value.workLocation,
        commute: value.commute,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}
