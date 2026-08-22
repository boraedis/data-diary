import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  text,
  timestamp,
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

// --- workouts / workout_sets ---------------------------------------------
// The one repeating structure in the health domain: a day can have any
// number of workouts, each with any number of sets. Modeled as satellite
// tables (per the rebuild plan) instead of the legacy nested-array-on-a-
// document shape.
//
// `details` is a deliberate escape hatch: the legacy app drives extra,
// category-specific fields (e.g. a lifting exercise needing weight/reps
// fields a cardio one doesn't) off an external Firestore config
// (`searchs/exercise_categories`) that isn't available in this migration.
// Rather than guess at that shape, category-specific extras land here as
// JSON for now and get promoted to real columns in Phase 3 once real data
// migrates over and the actual patterns are visible.
export const workouts = pgTable(
  "workouts",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    // Free text for now, same reasoning as sleepLocationType above — the
    // legacy `searchs/exercises` and `searchs/places` catalogs aren't part
    // of this migration.
    exercise: text("exercise").notNull(),
    subtype: text("subtype").notNull(),
    dataSource: workoutDataSourceEnum("data_source").notNull().default("manual"),
    location: text("location"),
    durationMinutes: integer("duration_minutes"),
    details: jsonb("details").$type<Record<string, unknown>>(),
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

// --- day_people / day_places -------------------------------------------
// The legacy app referenced a `searchs/people` / `searchs/places` catalog
// (fixed 7-positive/3-negative person slots, 2 place slots) that isn't part
// of this migration. Free-text name plus a sort order carries the same
// "who/where, in order" shape forward without needing the catalog rebuilt
// first — same reasoning as workouts.exercise/location being free text.
export const dayPeople = pgTable(
  "day_people",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    valence: personValenceEnum("valence").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("day_people_date_idx").on(table.date)]
);

export const dayPlaces = pgTable(
  "day_places",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    placeName: text("place_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("day_places_date_idx").on(table.date)]
);

// --- entertainment_entries -------------------------------------------------
// Deliberately lightweight: the legacy app's entertainment day-link is five
// very different catalog-referencing shapes (movies/tvshows/sports/books/
// games), each pulling from its own catalog and dynamic enums (location
// types, sports game types, device lists) that aren't part of this
// migration. Fully modeling that relational catalog domain is already its
// own planned phase (Phase 5). This table captures just enough now — what
// you consumed today, free-text title, optional notes, and a JSON escape
// hatch for anything else you want to jot down — without trying to build
// the catalog domain a phase early.
export const entertainmentEntries = pgTable(
  "entertainment_entries",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    kind: entertainmentKindEnum("kind").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("entertainment_entries_date_idx").on(table.date)]
);

// --- Convenience types -----------------------------------------------------
export type DayType = (typeof dayTypeEnum.enumValues)[number];
export type WorkLocationOption = (typeof workLocationEnum.enumValues)[number];
export type CommuteOption = (typeof commuteEnum.enumValues)[number];
export type WorkoutDataSource = (typeof workoutDataSourceEnum.enumValues)[number];
export type PersonValence = (typeof personValenceEnum.enumValues)[number];
export type EntertainmentKind = (typeof entertainmentKindEnum.enumValues)[number];
