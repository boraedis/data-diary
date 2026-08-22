import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  commuteEnum,
  dayPeople,
  dayPlaces,
  days,
  dayTypeEnum,
  entertainmentEntries,
  entertainmentKindEnum,
  personValenceEnum,
  subEntries,
  workLocationEnum,
  workoutDataSourceEnum,
  workouts,
  workoutSets,
  type CommuteOption,
  type DayType,
  type EntertainmentKind,
  type PersonValence,
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
  phoneUsageMinutes: number | null;
  laptopUsageMinutes: number | null;
  instagramUsageMinutes: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
  instagramFollowers: number | null;
  instagramFollowing: number | null;
  subs: SubEntry[];
  people: PersonEntry[];
  places: PlaceEntry[];
  entertainment: EntertainmentEntry[];
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

export type TechnologyPayload = {
  phoneUsageMinutes: number | null;
  laptopUsageMinutes: number | null;
  instagramUsageMinutes: number | null;
};

export type WeightPayload = {
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
};

export type SocialMediaPayload = {
  instagramFollowers: number | null;
  instagramFollowing: number | null;
};

export type SubEntry = { name: string; value: number };
export type SubsPayload = { entries: SubEntry[] };

export type PersonEntry = { name: string; valence: PersonValence; sortOrder: number };
export type PeoplePayload = { people: PersonEntry[] };

export type PlaceEntry = { name: string; sortOrder: number };
export type PlacesPayload = { places: PlaceEntry[] };

export type EntertainmentEntry = { kind: EntertainmentKind; title: string; notes: string | null };
export type EntertainmentPayload = { entries: EntertainmentEntry[] };

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

  const [subRows, peopleRows, placesRows, entertainmentRows] = await Promise.all([
    db.select().from(subEntries).where(eq(subEntries.date, date)).orderBy(asc(subEntries.id)),
    db
      .select()
      .from(dayPeople)
      .where(eq(dayPeople.date, date))
      .orderBy(asc(dayPeople.valence), asc(dayPeople.sortOrder)),
    db.select().from(dayPlaces).where(eq(dayPlaces.date, date)).orderBy(asc(dayPlaces.sortOrder)),
    db
      .select()
      .from(entertainmentEntries)
      .where(eq(entertainmentEntries.date, date))
      .orderBy(asc(entertainmentEntries.sortOrder)),
  ]);

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
    phoneUsageMinutes: dayRow?.phoneUsageMinutes ?? null,
    laptopUsageMinutes: dayRow?.laptopUsageMinutes ?? null,
    instagramUsageMinutes: dayRow?.instagramUsageMinutes ?? null,
    weightKg: dayRow?.weightKg ?? null,
    bodyFatPercent: dayRow?.bodyFatPercent ?? null,
    muscleMassKg: dayRow?.muscleMassKg ?? null,
    instagramFollowers: dayRow?.instagramFollowers ?? null,
    instagramFollowing: dayRow?.instagramFollowing ?? null,
    subs: subRows.map((s) => ({ name: s.name, value: s.value })),
    people: peopleRows.map((p) => ({
      name: p.personName,
      valence: p.valence,
      sortOrder: p.sortOrder,
    })),
    places: placesRows.map((p) => ({ name: p.placeName, sortOrder: p.sortOrder })),
    entertainment: entertainmentRows.map((e) => ({
      kind: e.kind,
      title: e.title,
      notes: e.notes,
    })),
  };
}

const DAY_TYPES = new Set<string>(dayTypeEnum.enumValues);
const WORK_LOCATIONS = new Set<string>(workLocationEnum.enumValues);
const COMMUTES = new Set<string>(commuteEnum.enumValues);
const DATA_SOURCES = new Set<string>(workoutDataSourceEnum.enumValues);
const PERSON_VALENCES = new Set<string>(personValenceEnum.enumValues);
const ENTERTAINMENT_KINDS = new Set<string>(entertainmentKindEnum.enumValues);

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

export function validateTechnologyPayload(body: unknown): Result<TechnologyPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      phoneUsageMinutes: typeof b.phoneUsageMinutes === "number" ? b.phoneUsageMinutes : null,
      laptopUsageMinutes: typeof b.laptopUsageMinutes === "number" ? b.laptopUsageMinutes : null,
      instagramUsageMinutes:
        typeof b.instagramUsageMinutes === "number" ? b.instagramUsageMinutes : null,
    },
  };
}

export function validateWeightPayload(body: unknown): Result<WeightPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      weightKg: typeof b.weightKg === "number" ? b.weightKg : null,
      bodyFatPercent: typeof b.bodyFatPercent === "number" ? b.bodyFatPercent : null,
      muscleMassKg: typeof b.muscleMassKg === "number" ? b.muscleMassKg : null,
    },
  };
}

export function validateSocialMediaPayload(body: unknown): Result<SocialMediaPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      instagramFollowers: typeof b.instagramFollowers === "number" ? b.instagramFollowers : null,
      instagramFollowing: typeof b.instagramFollowing === "number" ? b.instagramFollowing : null,
    },
  };
}

export function validateSubsPayload(body: unknown): Result<SubsPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: SubEntry[] = [];
  for (const e of input) {
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!name) return { ok: false, error: "Every subscription needs a name" };
    const value = typeof e.value === "number" ? e.value : NaN;
    // Legacy range was 0-10 (an in-app usage/satisfaction rating, not a
    // dollar amount, despite the category name).
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      return { ok: false, error: `${name}: value must be a whole number between 0 and 10` };
    }
    entries.push({ name, value });
  }

  return { ok: true, value: { entries } };
}

export function validatePeoplePayload(body: unknown): Result<PeoplePayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.people) ? (b.people as Record<string, unknown>[]) : [];
  const people: PersonEntry[] = [];
  for (const p of input) {
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) return { ok: false, error: "Every person needs a name" };
    if (!PERSON_VALENCES.has(p.valence as string)) {
      return { ok: false, error: `${name}: invalid valence` };
    }
    people.push({
      name,
      valence: p.valence as PersonValence,
      sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : people.length,
    });
  }

  return { ok: true, value: { people } };
}

export function validatePlacesPayload(body: unknown): Result<PlacesPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.places) ? (b.places as Record<string, unknown>[]) : [];
  const places: PlaceEntry[] = [];
  for (const p of input) {
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) return { ok: false, error: "Every place needs a name" };
    places.push({ name, sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : places.length });
  }

  return { ok: true, value: { places } };
}

export function validateEntertainmentPayload(body: unknown): Result<EntertainmentPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: EntertainmentEntry[] = [];
  for (const e of input) {
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) return { ok: false, error: "Every entry needs a title" };
    if (!ENTERTAINMENT_KINDS.has(e.kind as string)) {
      return { ok: false, error: `${title}: invalid kind` };
    }
    entries.push({
      kind: e.kind as EntertainmentKind,
      title,
      notes: typeof e.notes === "string" && e.notes.trim() ? e.notes.trim() : null,
    });
  }

  return { ok: true, value: { entries } };
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

export async function saveTechnology(date: string, value: TechnologyPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      phoneUsageMinutes: value.phoneUsageMinutes,
      laptopUsageMinutes: value.laptopUsageMinutes,
      instagramUsageMinutes: value.instagramUsageMinutes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        phoneUsageMinutes: value.phoneUsageMinutes,
        laptopUsageMinutes: value.laptopUsageMinutes,
        instagramUsageMinutes: value.instagramUsageMinutes,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveWeight(date: string, value: WeightPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      weightKg: value.weightKg,
      bodyFatPercent: value.bodyFatPercent,
      muscleMassKg: value.muscleMassKg,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        weightKg: value.weightKg,
        bodyFatPercent: value.bodyFatPercent,
        muscleMassKg: value.muscleMassKg,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveSocialMedia(date: string, value: SocialMediaPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      instagramFollowers: value.instagramFollowers,
      instagramFollowing: value.instagramFollowing,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        instagramFollowers: value.instagramFollowers,
        instagramFollowing: value.instagramFollowing,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

// The remaining four sections (subs, people, places, entertainment) are all
// pure lists with no scalar day-row fields of their own — saving them is a
// straight replace-on-save against their satellite table, no `days` upsert
// needed at all (though if the day row doesn't exist yet, e.g. logging
// people before touching any other section, it's created bare so the FK on
// each satellite row has something to reference).

async function ensureDayRow(date: string): Promise<void> {
  const db = getDb();
  await db.insert(days).values({ date }).onConflictDoNothing({ target: days.date });
}

export async function saveSubs(date: string, value: SubsPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(subEntries).where(eq(subEntries.date, date));
  if (value.entries.length > 0) {
    await db.insert(subEntries).values(
      value.entries.map((e) => ({ date, name: e.name, value: e.value }))
    );
  }

  return loadDay(date);
}

export async function savePeople(date: string, value: PeoplePayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(dayPeople).where(eq(dayPeople.date, date));
  if (value.people.length > 0) {
    await db.insert(dayPeople).values(
      value.people.map((p) => ({
        date,
        personName: p.name,
        valence: p.valence,
        sortOrder: p.sortOrder,
      }))
    );
  }

  return loadDay(date);
}

export async function savePlaces(date: string, value: PlacesPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(dayPlaces).where(eq(dayPlaces.date, date));
  if (value.places.length > 0) {
    await db.insert(dayPlaces).values(
      value.places.map((p) => ({ date, placeName: p.name, sortOrder: p.sortOrder }))
    );
  }

  return loadDay(date);
}

export async function saveEntertainment(date: string, value: EntertainmentPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(entertainmentEntries).where(eq(entertainmentEntries.date, date));
  if (value.entries.length > 0) {
    await db.insert(entertainmentEntries).values(
      value.entries.map((e, i) => ({
        date,
        kind: e.kind,
        title: e.title,
        notes: e.notes,
        sortOrder: i,
      }))
    );
  }

  return loadDay(date);
}
