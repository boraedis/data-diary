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

// --- Convenience types -----------------------------------------------------
export type DayType = (typeof dayTypeEnum.enumValues)[number];
export type WorkLocationOption = (typeof workLocationEnum.enumValues)[number];
export type CommuteOption = (typeof commuteEnum.enumValues)[number];
export type WorkoutDataSource = (typeof workoutDataSourceEnum.enumValues)[number];
