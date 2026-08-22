import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Enums -------------------------------------------------------------
// Fixed, small option sets carried over from the legacy app's entry forms.

export const dayTypeEnum = pgEnum("day_type", [
  "work",
  "dayoff",
  "vacation",
  "travel",
  "sick",
  "jobless",
]);

export const workLocationEnum = pgEnum("work_location_option", [
  "home",
  "office",
  "cafe",
  "travel",
  "other",
]);

export const commuteEnum = pgEnum("commute_option", [
  "car",
  "carpool",
  "taxi",
  "public_transit",
  "bike",
  "walk",
  "other",
]);

export const workoutDataSourceEnum = pgEnum("workout_data_source", [
  "manual",
  "hevy",
]);

// What fields a workout needs is driven by the *category* of exercise, not
// the exercise itself: distance/cardio exercises (running, jogging, ...)
// track duration + distance + perceived effort; sport exercises (tennis,
// basketball, ...) just track duration; strength exercises use the existing
// per-set reps/weight structure (workout_sets) and no scalar duration at
// all. Every exercise in the catalog below is tagged with exactly one of
// these, and the entry form shows the matching fields once an exercise is
// picked.
export const exerciseCategoryEnum = pgEnum("exercise_category", [
  "distance",
  "sport",
  "strength",
]);

export const personValenceEnum = pgEnum("person_valence", ["positive", "negative"]);

export const entertainmentKindEnum = pgEnum("entertainment_kind", [
  "movie",
  "tvshow",
  "sport",
  "book",
  "game",
]);

// --- days ----------------------------------------------------------------
// One row per calendar day. "date" is a plain, timezone-free calendar date —
// whatever date you say you're journaling for, not a timestamp derived from
// a server clock or a fixed IANA zone. This is the root of the day-entry
// domain: health, sleep, happiness, and work all live here as scalar
// columns, mirroring the legacy `days/{daynum}` Firestore document. Workouts
// are the one repeating structure in this domain, so they get their own
// satellite tables below instead of a nested array column.
export const days = pgTable("days", {
  date: date("date", { mode: "string" }).primaryKey(),

  // --- Health ---
  distanceWalkedKm: real("distance_walked_km"),
  coffees: integer("coffees"),
  // Tri-state: null = not recorded, true/false = recorded. Replaces the
  // legacy pair of independent "sick-yes"/"sick-no" radios with one nullable
  // column carrying the same three states.
  sick: boolean("sick"),

  // --- Sleep ---
  // Local clock times ("HH:MM"), no timezone conversion — matches how
  // they're entered. `wakeCrossedMidnight` captures whether waketime is on
  // the calendar day *after* sleeptime; the legacy app actually computed
  // this client-side and then discarded it before saving, so duration
  // across midnight was unrecoverable from the stored data. This fixes that.
  sleepTime: text("sleep_time"),
  wakeTime: text("wake_time"),
  wakeCrossedMidnight: boolean("wake_crossed_midnight").notNull().default(false),
  // Free text for now rather than a foreign key into a location catalog —
  // the legacy `searchs/sleep_location_types` catalog isn't part of this
  // migration yet. Revisit if/when a real places/locations domain lands.
  sleepLocationType: text("sleep_location_type"),
  sleepLocationSubtype: text("sleep_location_subtype"),
  // Legacy stored naps as separate {hours, mins}; flattened to one total.
  napMinutes: integer("nap_minutes"),

  // --- Happiness ---
  happiness: smallint("happiness"), // 0-100
  happinessReason: text("happiness_reason"),
  journal: text("journal"),
  dayType: dayTypeEnum("day_type"),

  // --- Work ---
  productivity: smallint("productivity"), // 0-100
  // Legacy stored {hours, minutes}; flattened to one total, same pattern as
  // napMinutes above.
  workDurationMinutes: integer("work_duration_minutes"),
  workLocation: workLocationEnum("work_location").array(),
  commute: commuteEnum("commute").array(),

  // --- Technology ---
  // Legacy stored each as {hours, mins}; flattened to one total per
  // category, same pattern as napMinutes/workDurationMinutes above.
  phoneUsageMinutes: integer("phone_usage_minutes"),
  laptopUsageMinutes: integer("laptop_usage_minutes"),
  instagramUsageMinutes: integer("instagram_usage_minutes"),

  // --- Weight ---
  // The legacy app actually saved these as raw strings on the day document
  // (a bug — only its `views/weight` mirror parsed them as floats). Storing
  // as real here from the start rather than carrying that bug forward.
  weightKg: real("weight_kg"),
  bodyFatPercent: real("body_fat_percent"),
  muscleMassKg: real("muscle_mass_kg"),

  // --- Social media ---
  instagramFollowers: integer("instagram_followers"),
  instagramFollowing: integer("instagram_following"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- exercises / exercise_locations --------------------------------------
// Catalogs, not free text: the legacy app drove workout entry off Firestore
// config docs (`searchs/exercises`, `searchs/places`) rather than letting
// you type anything, and that's worth carrying forward — it's what keeps
// years of workout data using consistent names instead of "Running" one day
// and "running" the next. Both start empty and grow via the entry form's
// "+ New" flow rather than being seeded with a guessed list.
//
// `category` on `exercises` is what drives which fields the entry form
// shows (see exerciseCategoryEnum above); `exercise_locations` are scoped
// to a category too (a running location list looks nothing like a lifting
// location list), not shared across all exercises.
export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: exerciseCategoryEnum("category").notNull(),
});

export const exerciseLocations = pgTable(
  "exercise_locations",
  {
    id: serial("id").primaryKey(),
    category: exerciseCategoryEnum("category").notNull(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("exercise_locations_category_name_idx").on(table.category, table.name)]
);

// --- workouts / workout_sets ---------------------------------------------
// The one repeating structure in the health domain: a day can have any
// number of workouts, each with any number of sets. Modeled as satellite
// tables (per the rebuild plan) instead of the legacy nested-array-on-a-
// document shape.
//
// Which of durationMinutes/distanceKm/effort get used depends on the
// exercise's category (see exerciseCategoryEnum): distance exercises use
// durationMinutes + distanceKm + effort, sport exercises use just
// durationMinutes, and strength exercises use none of the three — they
// carry their data entirely in workout_sets instead.
export const workouts = pgTable(
  "workouts",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    locationId: integer("location_id").references(() => exerciseLocations.id, {
      onDelete: "set null",
    }),
    dataSource: workoutDataSourceEnum("data_source").notNull().default("manual"),
    durationMinutes: integer("duration_minutes"),
    distanceKm: real("distance_km"),
    effort: smallint("effort"), // 0-100 perceived effort, distance category only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workouts_date_idx").on(table.date)]
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: serial("id").primaryKey(),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    reps: integer("reps"),
    weightLbs: real("weight_lbs"),
    durationSeconds: integer("duration_seconds"),
  },
  (table) => [index("workout_sets_workout_id_idx").on(table.workoutId)]
);

// --- sub_entries -----------------------------------------------------------
// The legacy app's subscription list was itself configurable — it read the
// set of tracked subscription names from a separate Firestore config doc
// (`entry_structure/Subs`) rather than hardcoding them, and that doc wasn't
// available during this migration. A normalized (date, name, value) table
// carries that same flexibility forward without needing fixed columns per
// subscription — new subscriptions just become new rows, no schema change.
export const subEntries = pgTable(
  "sub_entries",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull(), // legacy range was 0-10
  },
  (table) => [index("sub_entries_date_idx").on(table.date)]
);

// --- people / places (catalogs) ------------------------------------------
// The legacy app referenced a `searchs/people` / `searchs/places` catalog —
// day-level people/places entries always pointed at a name from a
// maintained list, never free text. These are that catalog, rebuilt: they
// start empty and grow via the entry form's "+ New" flow.
export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const places = pgTable("places", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- day_people / day_places -------------------------------------------
// Legacy fixed the slate at 7 positive + 3 negative person slots and 2
// place slots — always that many, whether or not they're all filled in on
// a given day. `slot` is that fixed position (0-6 for positive people, 0-2
// for negative people, 0-1 for places), not a free sort order; the unique
// index on (date, valence, slot) / (date, slot) enforces one entry per
// slot per day. personId/placeId point at the catalogs above rather than
// storing a name.
export const dayPeople = pgTable(
  "day_people",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    valence: personValenceEnum("valence").notNull(),
    slot: integer("slot").notNull(),
  },
  (table) => [
    index("day_people_date_idx").on(table.date),
    uniqueIndex("day_people_date_valence_slot_idx").on(table.date, table.valence, table.slot),
  ]
);

export const dayPlaces = pgTable(
  "day_places",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    placeId: integer("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "restrict" }),
    slot: integer("slot").notNull(),
  },
  (table) => [
    index("day_places_date_idx").on(table.date),
    uniqueIndex("day_places_date_slot_idx").on(table.date, table.slot),
  ]
);

// --- entertainment_catalog / entertainment_entries ------------------------
// Same catalog-not-free-text shape as people/places/exercises: what you
// consumed is picked from a maintained (kind, title) catalog via the "+
// New" flow, not typed fresh every time. Deliberately still lightweight
// compared to the legacy app's five full catalog-referencing entertainment
// shapes (movies/tvshows/sports/books/games each had their own schema and
// external catalogs) — that's real catalog-domain work already scoped as
// Phase 5. This just needs "what, and for how long" until then.
export const entertainmentCatalog = pgTable(
  "entertainment_catalog",
  {
    id: serial("id").primaryKey(),
    kind: entertainmentKindEnum("kind").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("entertainment_catalog_kind_title_idx").on(table.kind, table.title)]
);

export const entertainmentEntries = pgTable(
  "entertainment_entries",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    entertainmentId: integer("entertainment_id")
      .notNull()
      .references(() => entertainmentCatalog.id, { onDelete: "restrict" }),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("entertainment_entries_date_idx").on(table.date)]
);

// --- Convenience types -----------------------------------------------------
export type DayType = (typeof dayTypeEnum.enumValues)[number];
export type WorkLocationOption = (typeof workLocationEnum.enumValues)[number];
export type CommuteOption = (typeof commuteEnum.enumValues)[number];
export type WorkoutDataSource = (typeof workoutDataSourceEnum.enumValues)[number];
export type ExerciseCategory = (typeof exerciseCategoryEnum.enumValues)[number];
export type PersonValence = (typeof personValenceEnum.enumValues)[number];
export type EntertainmentKind = (typeof entertainmentKindEnum.enumValues)[number];
