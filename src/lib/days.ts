import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  commuteEnum,
  dayPeople,
  dayPlaces,
  days,
  dayTypeEnum,
  entertainmentCatalog,
  entertainmentEntries,
  entertainmentKindEnum,
  exerciseCategoryEnum,
  exerciseLocations,
  exercises,
  people,
  personValenceEnum,
  places,
  subEntries,
  workLocationEnum,
  workoutDataSourceEnum,
  workouts,
  workoutSets,
  type CommuteOption,
  type DayType,
  type EntertainmentKind,
  type ExerciseCategory,
  type PersonValence,
  type WorkLocationOption,
  type WorkoutDataSource,
} from "@/db/schema";

// Fixed slot counts, carried over from the legacy app's `searchs/people` /
// `searchs/places` catalogs: always 7 positive + 3 negative person slots,
// always 2 place slots, whether or not every slot is filled on a given day.
export const POSITIVE_PEOPLE_SLOTS = 7;
export const NEGATIVE_PEOPLE_SLOTS = 3;
export const PLACE_SLOTS = 2;

export type WorkoutSetPayload = {
  setNumber: number;
  reps: number | null;
  weightLbs: number | null;
  durationSeconds: number | null;
};

// What a workout save actually needs. `sets` only makes sense for
// strength-category exercises; durationMinutes/distanceKm/effort only make
// sense for distance/sport-category ones — see exerciseCategoryEnum in the
// schema for which fields a given exercise's category expects. Nothing here
// enforces that pairing (the form does, by only showing the relevant
// fields); saving is happy to store nulls for whichever fields don't apply.
export type WorkoutPayload = {
  exerciseId: number;
  locationId: number | null;
  dataSource: WorkoutDataSource;
  durationMinutes: number | null;
  distanceKm: number | null;
  effort: number | null;
  sets: WorkoutSetPayload[];
};

// The read-side shape of a workout: same fields as WorkoutPayload, plus the
// exercise's name/category and the location's name resolved via join, so
// the entry form and summary page don't need a second catalog round-trip
// just to label what's already saved.
export type WorkoutEntry = WorkoutPayload & {
  exerciseName: string;
  exerciseCategory: ExerciseCategory;
  locationName: string | null;
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
  workouts: WorkoutEntry[];
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

// personId/placeId point at the people/places catalogs; slot is the fixed
// position within its valence (people) or within the day (places) — see
// the POSITIVE_PEOPLE_SLOTS/NEGATIVE_PEOPLE_SLOTS/PLACE_SLOTS constants
// above. `name` is resolved via join for display and isn't part of what
// gets saved (see PeoplePayload/PlacesPayload below).
export type PersonEntry = { slot: number; valence: PersonValence; personId: number; name: string };
export type PeoplePayload = { entries: { slot: number; valence: PersonValence; personId: number }[] };

export type PlaceEntry = { slot: number; placeId: number; name: string };
export type PlacesPayload = { entries: { slot: number; placeId: number }[] };

export type EntertainmentEntry = {
  entertainmentId: number;
  kind: EntertainmentKind;
  title: string;
  durationMinutes: number | null;
  notes: string | null;
};
export type EntertainmentPayload = {
  entries: { entertainmentId: number; durationMinutes: number | null; notes: string | null }[];
};

// Catalog item shapes carry every field the legacy "New Person"/"New Place"/
// "New entertainment" modals captured (see the schema comments above people/
// places/entertainmentCatalog for exactly what was and wasn't carried over)
// — the entry forms need these for both the "+ New" creation modals and for
// building disambiguating secondary/search text in the search panel (see
// components/entry-forms/search-panel.tsx).
export type PersonCatalogItem = {
  id: number;
  name: string;
  nicknames: string[];
  birthdate: string | null;
  gender: string | null;
  tag: string | null;
};
export type PlaceCatalogItem = {
  id: number;
  name: string;
  alias: string | null;
  address: string | null;
  category: string | null;
};
export type ExerciseCatalogItem = { id: number; name: string; category: ExerciseCategory };
export type LocationCatalogItem = { id: number; name: string; category: ExerciseCategory };
export type EntertainmentCatalogItem = {
  id: number;
  kind: EntertainmentKind;
  title: string;
  detail: string | null;
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
    .select({
      id: workouts.id,
      exerciseId: workouts.exerciseId,
      exerciseName: exercises.name,
      exerciseCategory: exercises.category,
      locationId: workouts.locationId,
      locationName: exerciseLocations.name,
      dataSource: workouts.dataSource,
      durationMinutes: workouts.durationMinutes,
      distanceKm: workouts.distanceKm,
      effort: workouts.effort,
    })
    .from(workouts)
    .innerJoin(exercises, eq(workouts.exerciseId, exercises.id))
    .leftJoin(exerciseLocations, eq(workouts.locationId, exerciseLocations.id))
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
      .select({
        slot: dayPeople.slot,
        valence: dayPeople.valence,
        personId: dayPeople.personId,
        name: people.name,
      })
      .from(dayPeople)
      .innerJoin(people, eq(dayPeople.personId, people.id))
      .where(eq(dayPeople.date, date))
      .orderBy(asc(dayPeople.valence), asc(dayPeople.slot)),
    db
      .select({ slot: dayPlaces.slot, placeId: dayPlaces.placeId, name: places.name })
      .from(dayPlaces)
      .innerJoin(places, eq(dayPlaces.placeId, places.id))
      .where(eq(dayPlaces.date, date))
      .orderBy(asc(dayPlaces.slot)),
    db
      .select({
        entertainmentId: entertainmentEntries.entertainmentId,
        durationMinutes: entertainmentEntries.durationMinutes,
        notes: entertainmentEntries.notes,
        sortOrder: entertainmentEntries.sortOrder,
        kind: entertainmentCatalog.kind,
        title: entertainmentCatalog.title,
      })
      .from(entertainmentEntries)
      .innerJoin(entertainmentCatalog, eq(entertainmentEntries.entertainmentId, entertainmentCatalog.id))
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
      exerciseId: w.exerciseId,
      exerciseName: w.exerciseName,
      exerciseCategory: w.exerciseCategory,
      locationId: w.locationId,
      locationName: w.locationName,
      dataSource: w.dataSource,
      durationMinutes: w.durationMinutes,
      distanceKm: w.distanceKm,
      effort: w.effort,
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
      slot: p.slot,
      valence: p.valence,
      personId: p.personId,
      name: p.name,
    })),
    places: placesRows.map((p) => ({ slot: p.slot, placeId: p.placeId, name: p.name })),
    entertainment: entertainmentRows.map((e) => ({
      entertainmentId: e.entertainmentId,
      kind: e.kind,
      title: e.title,
      durationMinutes: e.durationMinutes,
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
const EXERCISE_CATEGORIES = new Set<string>(exerciseCategoryEnum.enumValues);

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
    const exerciseId = typeof w.exerciseId === "number" ? w.exerciseId : NaN;
    if (!Number.isInteger(exerciseId)) {
      return { ok: false, error: "Every workout needs an exercise" };
    }

    const dataSource = DATA_SOURCES.has(w.dataSource as string)
      ? (w.dataSource as WorkoutDataSource)
      : "manual";

    const setsInput = Array.isArray(w.sets) ? (w.sets as Record<string, unknown>[]) : [];
    parsed.push({
      exerciseId,
      locationId: typeof w.locationId === "number" ? w.locationId : null,
      dataSource,
      durationMinutes: typeof w.durationMinutes === "number" ? w.durationMinutes : null,
      distanceKm: typeof w.distanceKm === "number" ? w.distanceKm : null,
      effort: typeof w.effort === "number" ? w.effort : null,
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
    if (!name) return { ok: false, error: "Every sub needs a name" };
    const value = typeof e.value === "number" ? e.value : NaN;
    // Legacy range was 0-10 (an in-app usage/satisfaction rating, not a
    // dollar amount, despite the category being subscriptions).
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

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const seenSlots = new Set<string>();
  const entries: PeoplePayload["entries"] = [];
  for (const e of input) {
    const valence = e.valence as string;
    if (!PERSON_VALENCES.has(valence)) {
      return { ok: false, error: "Invalid valence" };
    }
    const maxSlot = valence === "positive" ? POSITIVE_PEOPLE_SLOTS - 1 : NEGATIVE_PEOPLE_SLOTS - 1;
    const slot = typeof e.slot === "number" ? e.slot : NaN;
    if (!Number.isInteger(slot) || slot < 0 || slot > maxSlot) {
      return { ok: false, error: `Invalid slot for ${valence} person` };
    }
    const slotKey = `${valence}:${slot}`;
    if (seenSlots.has(slotKey)) {
      return { ok: false, error: "Duplicate person slot" };
    }
    seenSlots.add(slotKey);

    const personId = typeof e.personId === "number" ? e.personId : NaN;
    if (!Number.isInteger(personId)) {
      return { ok: false, error: "Invalid person" };
    }
    entries.push({ slot, valence: valence as PersonValence, personId });
  }

  return { ok: true, value: { entries } };
}

export function validatePlacesPayload(body: unknown): Result<PlacesPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const seenSlots = new Set<number>();
  const entries: PlacesPayload["entries"] = [];
  for (const e of input) {
    const slot = typeof e.slot === "number" ? e.slot : NaN;
    if (!Number.isInteger(slot) || slot < 0 || slot > PLACE_SLOTS - 1) {
      return { ok: false, error: "Invalid place slot" };
    }
    if (seenSlots.has(slot)) {
      return { ok: false, error: "Duplicate place slot" };
    }
    seenSlots.add(slot);

    const placeId = typeof e.placeId === "number" ? e.placeId : NaN;
    if (!Number.isInteger(placeId)) {
      return { ok: false, error: "Invalid place" };
    }
    entries.push({ slot, placeId });
  }

  return { ok: true, value: { entries } };
}

export function validateEntertainmentPayload(body: unknown): Result<EntertainmentPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: EntertainmentPayload["entries"] = [];
  for (const e of input) {
    const entertainmentId = typeof e.entertainmentId === "number" ? e.entertainmentId : NaN;
    if (!Number.isInteger(entertainmentId)) {
      return { ok: false, error: "Invalid entertainment selection" };
    }
    entries.push({
      entertainmentId,
      durationMinutes: typeof e.durationMinutes === "number" ? e.durationMinutes : null,
      notes: typeof e.notes === "string" && e.notes.trim() ? e.notes.trim() : null,
    });
  }

  return { ok: true, value: { entries } };
}

type PersonCatalogInput = {
  name: string;
  nicknames: string[];
  birthdate: string | null;
  gender: string | null;
  tag: string | null;
};

// Only `name` is required — the legacy "New Person" modal treated
// nicknames/birthdate/gender/tag as optional extras, not gatekeeping fields.
export function validatePersonCatalogEntry(body: unknown): Result<PersonCatalogInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  const nicknames = Array.isArray(b.nicknames)
    ? (b.nicknames as unknown[])
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .map((n) => n.trim())
    : [];
  const birthdate = typeof b.birthdate === "string" && b.birthdate.trim() ? b.birthdate.trim() : null;
  const gender = typeof b.gender === "string" && b.gender.trim() ? b.gender.trim() : null;
  const tag = typeof b.tag === "string" && b.tag.trim() ? b.tag.trim() : null;

  return { ok: true, value: { name, nicknames, birthdate, gender, tag } };
}

type PlaceCatalogInput = {
  name: string;
  alias: string | null;
  address: string | null;
  category: string | null;
};

// Same "only name is required" rule as people — alias/address/category are
// the legacy "New Place" modal's optional extras (with its region hierarchy
// and category/subcategory tree deliberately not carried over, see the
// schema comment above the `places` table).
export function validatePlaceCatalogEntry(body: unknown): Result<PlaceCatalogInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  const alias = typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null;
  const address = typeof b.address === "string" && b.address.trim() ? b.address.trim() : null;
  const category = typeof b.category === "string" && b.category.trim() ? b.category.trim() : null;

  return { ok: true, value: { name, alias, address, category } };
}

export function validateExerciseCatalogEntry(
  body: unknown
): Result<{ name: string; category: ExerciseCategory }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (!EXERCISE_CATEGORIES.has(b.category as string)) {
    return { ok: false, error: "Invalid category" };
  }
  return { ok: true, value: { name, category: b.category as ExerciseCategory } };
}

export function validateLocationCatalogEntry(
  body: unknown
): Result<{ name: string; category: ExerciseCategory }> {
  // Same shape as an exercise catalog entry — a location is scoped to a
  // category exactly like an exercise is.
  return validateExerciseCatalogEntry(body);
}

export function validateEntertainmentCatalogEntry(
  body: unknown
): Result<{ kind: EntertainmentKind; title: string; detail: string | null }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };
  if (!ENTERTAINMENT_KINDS.has(b.kind as string)) {
    return { ok: false, error: "Invalid kind" };
  }
  const detail = typeof b.detail === "string" && b.detail.trim() ? b.detail.trim() : null;
  return { ok: true, value: { kind: b.kind as EntertainmentKind, title, detail } };
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
        exerciseId: w.exerciseId,
        locationId: w.locationId,
        dataSource: w.dataSource,
        durationMinutes: w.durationMinutes,
        distanceKm: w.distanceKm,
        effort: w.effort,
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

// The remaining sections (subs, people, places, entertainment) have no
// scalar day-row fields of their own — saving them is a straight
// replace-on-save against their satellite table, no `days` upsert needed
// (though if the day row doesn't exist yet, e.g. logging people before
// touching any other section, it's created bare so the FK on each
// satellite row has something to reference).

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
  if (value.entries.length > 0) {
    await db.insert(dayPeople).values(
      value.entries.map((e) => ({ date, personId: e.personId, valence: e.valence, slot: e.slot }))
    );
  }

  return loadDay(date);
}

export async function savePlaces(date: string, value: PlacesPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(dayPlaces).where(eq(dayPlaces.date, date));
  if (value.entries.length > 0) {
    await db.insert(dayPlaces).values(
      value.entries.map((e) => ({ date, placeId: e.placeId, slot: e.slot }))
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
        entertainmentId: e.entertainmentId,
        durationMinutes: e.durationMinutes,
        notes: e.notes,
        sortOrder: i,
      }))
    );
  }

  return loadDay(date);
}

// --- Catalogs --------------------------------------------------------------
// People/places/exercises/exercise-locations/entertainment all follow the
// same "pick from a maintained list, add new via a quick create" pattern
// instead of free text. Every create function is an upsert-by-name (or
// upsert-by-(category,name) / (kind,title) where the catalog needs a
// compound identity) rather than a plain insert: typing a name that
// already exists just selects the existing catalog row instead of erroring
// or creating a duplicate, which matters for a quick "+ New" modal where
// erroring on an accidental re-type would be an annoying dead end.

const PERSON_COLUMNS = {
  id: people.id,
  name: people.name,
  nicknames: people.nicknames,
  birthdate: people.birthdate,
  gender: people.gender,
  tag: people.tag,
};

export async function listPeopleCatalog(): Promise<PersonCatalogItem[]> {
  const db = getDb();
  return db.select(PERSON_COLUMNS).from(people).orderBy(asc(people.name));
}

export async function createPersonCatalogEntry(input: PersonCatalogInput): Promise<PersonCatalogItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(people)
    .values({
      name: trimmed,
      nicknames: input.nicknames,
      birthdate: input.birthdate,
      gender: input.gender,
      tag: input.tag,
    })
    .onConflictDoNothing({ target: people.name })
    .returning(PERSON_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(PERSON_COLUMNS).from(people).where(eq(people.name, trimmed));
  return existing;
}

const PLACE_COLUMNS = {
  id: places.id,
  name: places.name,
  alias: places.alias,
  address: places.address,
  category: places.category,
};

export async function listPlacesCatalog(): Promise<PlaceCatalogItem[]> {
  const db = getDb();
  return db.select(PLACE_COLUMNS).from(places).orderBy(asc(places.name));
}

export async function createPlaceCatalogEntry(input: PlaceCatalogInput): Promise<PlaceCatalogItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(places)
    .values({
      name: trimmed,
      alias: input.alias,
      address: input.address,
      category: input.category,
    })
    .onConflictDoNothing({ target: places.name })
    .returning(PLACE_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(PLACE_COLUMNS).from(places).where(eq(places.name, trimmed));
  return existing;
}

const ENTERTAINMENT_CATALOG_COLUMNS = {
  id: entertainmentCatalog.id,
  kind: entertainmentCatalog.kind,
  title: entertainmentCatalog.title,
  detail: entertainmentCatalog.detail,
};

export async function listEntertainmentCatalog(): Promise<EntertainmentCatalogItem[]> {
  const db = getDb();
  return db
    .select(ENTERTAINMENT_CATALOG_COLUMNS)
    .from(entertainmentCatalog)
    .orderBy(asc(entertainmentCatalog.kind), asc(entertainmentCatalog.title));
}

export async function createEntertainmentCatalogEntry(
  kind: EntertainmentKind,
  title: string,
  detail: string | null = null
): Promise<EntertainmentCatalogItem> {
  const db = getDb();
  const trimmed = title.trim();
  const [inserted] = await db
    .insert(entertainmentCatalog)
    .values({ kind, title: trimmed, detail })
    .onConflictDoNothing({ target: [entertainmentCatalog.kind, entertainmentCatalog.title] })
    .returning(ENTERTAINMENT_CATALOG_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db
    .select(ENTERTAINMENT_CATALOG_COLUMNS)
    .from(entertainmentCatalog)
    .where(and(eq(entertainmentCatalog.kind, kind), eq(entertainmentCatalog.title, trimmed)));
  return existing;
}

export async function listExercisesCatalog(): Promise<ExerciseCatalogItem[]> {
  const db = getDb();
  return db
    .select({ id: exercises.id, name: exercises.name, category: exercises.category })
    .from(exercises)
    .orderBy(asc(exercises.name));
}

export async function createExerciseCatalogEntry(
  name: string,
  category: ExerciseCategory
): Promise<ExerciseCatalogItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(exercises)
    .values({ name: trimmed, category })
    .onConflictDoNothing({ target: exercises.name })
    .returning({ id: exercises.id, name: exercises.name, category: exercises.category });
  if (inserted) return inserted;
  const [existing] = await db
    .select({ id: exercises.id, name: exercises.name, category: exercises.category })
    .from(exercises)
    .where(eq(exercises.name, trimmed));
  return existing;
}

export async function listExerciseLocationsCatalog(): Promise<LocationCatalogItem[]> {
  const db = getDb();
  return db
    .select({ id: exerciseLocations.id, name: exerciseLocations.name, category: exerciseLocations.category })
    .from(exerciseLocations)
    .orderBy(asc(exerciseLocations.category), asc(exerciseLocations.name));
}

export async function createExerciseLocationCatalogEntry(
  name: string,
  category: ExerciseCategory
): Promise<LocationCatalogItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(exerciseLocations)
    .values({ name: trimmed, category })
    .onConflictDoNothing({ target: [exerciseLocations.category, exerciseLocations.name] })
    .returning({ id: exerciseLocations.id, name: exerciseLocations.name, category: exerciseLocations.category });
  if (inserted) return inserted;
  const [existing] = await db
    .select({ id: exerciseLocations.id, name: exerciseLocations.name, category: exerciseLocations.category })
    .from(exerciseLocations)
    .where(and(eq(exerciseLocations.category, category), eq(exerciseLocations.name, trimmed)));
  return existing;
}
