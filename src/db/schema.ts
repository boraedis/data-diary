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
//
// The legacy app's real `searchs/exercise_categories` catalog is actually a
// free-text, user-managed list (arbitrary category names, each with its own
// custom form-field config) rather than this fixed 3-value set — discovered
// while scoping the Phase 3 historical migration. Deliberately kept as a
// fixed enum for now (simplicity, and the real category names aren't known
// without live Firestore access), but the intent is to let this become a
// real user-managed catalog later. When that happens: don't try to grow
// this enum in place — Postgres enums can gain values but not lose/rename
// them cleanly — instead add a proper `exercise_categories` table (id, name,
// same shape as `people`/`places` below) and swap `exercises.category` /
// this column's few call sites over to a foreign key, the same migration
// shape people/places/subs went through when they moved off satellite
// tables. Every place that currently pattern-matches on the three literal
// category strings (health-entry-form.tsx's field toggling, most notably)
// is exactly the list of call sites that swap would need to update.
export const exerciseCategoryEnum = pgEnum("exercise_category", [
  "distance",
  "sport",
  "strength",
]);

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

  // --- People (always exactly 7 positive + 3 negative slots) ---
  // The legacy Firestore day document stored these directly as
  // `person1`..`person7` / `negperson1`..`negperson3` fields on the day
  // itself, not in a separate collection — the slot count never varies, so
  // there's nothing a satellite table buys here that a fixed column
  // wouldn't. Each points at the `people` catalog below; "restrict" means a
  // person can't be deleted from that catalog while still referenced by
  // some day's slot. POSITIVE_PEOPLE_SLOTS/NEGATIVE_PEOPLE_SLOTS in
  // src/lib/days.ts are the source of truth for the slot counts.
  positivePerson1Id: integer("positive_person_1_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  positivePerson2Id: integer("positive_person_2_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  positivePerson3Id: integer("positive_person_3_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  positivePerson4Id: integer("positive_person_4_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  positivePerson5Id: integer("positive_person_5_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  positivePerson6Id: integer("positive_person_6_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  positivePerson7Id: integer("positive_person_7_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  negativePerson1Id: integer("negative_person_1_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  negativePerson2Id: integer("negative_person_2_id").references(() => people.id, {
    onDelete: "restrict",
  }),
  negativePerson3Id: integer("negative_person_3_id").references(() => people.id, {
    onDelete: "restrict",
  }),

  // --- Places (always exactly 2 slots) ---
  // Same reasoning as people above — legacy stored `place1`/`place2`
  // directly on the day document. PLACE_SLOTS in src/lib/days.ts is the
  // source of truth.
  place1Id: integer("place_1_id").references(() => places.id, { onDelete: "restrict" }),
  place2Id: integer("place_2_id").references(() => places.id, { onDelete: "restrict" }),

  // --- Subs (always exactly these nine, see SUB_NAMES in src/lib/days.ts) ---
  // Same reasoning again: nine fixed, named values (0-10) straight from the
  // user (the legacy `entry_structure/Subs` config doc wasn't reachable
  // during this migration) — not an open-ended list, so fixed columns beat
  // a normalized (date, name, value) table. Column names are the sub
  // abbreviations themselves.
  subA: smallint("sub_a"),
  subW: smallint("sub_w"),
  subC: smallint("sub_c"),
  subL: smallint("sub_l"),
  subNi: smallint("sub_ni"),
  subNO: smallint("sub_no"),
  subAd: smallint("sub_ad"),
  subD: smallint("sub_d"),
  subK: smallint("sub_k"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- exercises -------------------------------------------------------------
// A catalog, not free text: the legacy app drove workout entry off a
// Firestore config doc (`searchs/exercises`) rather than letting you type
// anything, and that's worth carrying forward — it's what keeps years of
// workout data using consistent names instead of "Running" one day and
// "running" the next. Starts empty and grows via the entry form's "+ New"
// flow rather than being seeded with a guessed list.
//
// `category` is what drives which fields the entry form shows (see
// exerciseCategoryEnum above). Workout *location* is NOT its own catalog —
// confirmed while scoping the Phase 3 migration that the legacy app points
// workout locations at the exact same `places` catalog day-level places
// use (`places[workout.location].name` in the legacy entry code); an
// earlier pass here had invented a separate, category-scoped
// `exercise_locations` table that didn't match that reality, so it's gone —
// see `workouts.locationId` below.
export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: exerciseCategoryEnum("category").notNull(),
});

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
    locationId: integer("location_id").references(() => places.id, {
      onDelete: "set null",
    }),
    // Equipment/variant free text (e.g. "Barbell" vs "Smith Machine" vs
    // "Dumbbell" for the same named exercise). The legacy app required this
    // on every workout and it turned out to carry real signal — the Phase 3
    // migration's dry run found subtype values on effectively every
    // exercise in the catalog — so it's carried forward here even though
    // the Phase 2 catalog redesign originally dropped it. Free text (not a
    // catalog) since it's exercise-specific and the legacy app treated it
    // the same way.
    subtype: text("subtype"),
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

// --- people / places (catalogs) ------------------------------------------
// The legacy app referenced a `searchs/people` / `searchs/places` catalog —
// day-level people/places entries always pointed at a name from a
// maintained list, never free text. These are that catalog, rebuilt: they
// start empty and grow via the entry form's "+ New" flow.
//
// Fields mirror the legacy "New Person"/"New Place" modals (functions/
// views/entry/database/new_person_form.*, new_place_form.*) — the legacy
// app searched people by nicknames (a person's full name was itself always
// pushed into that list, so matching "nicknames OR name" isn't needed as a
// separate rule) plus an optional single "tag" (a relationship label like
// "family"/"coworker"); places by an alias plus name. Deliberately NOT
// carried over: the legacy places catalog's full country -> region ->
// subregion hierarchy and category/subcategory taxonomy tree (functions/
// views/entry/database/world.*, new_place_form.js's addRegions/loadCategory)
// — that's a real nested-catalog domain of its own, not a search-UX fix;
// `category` here is a single free-text field standing in for it until
// that's worth building for real.
export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  nicknames: text("nicknames").array().notNull().default([]),
  birthdate: date("birthdate", { mode: "string" }),
  gender: text("gender"),
  tag: text("tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const places = pgTable("places", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  alias: text("alias"),
  address: text("address"),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    // Free-text disambiguator (a year, an author, a platform, whatever tells
    // two same-titled entries apart) — the legacy app got this for free from
    // TMDB lookups (release_date) or catalog fields (books' authors); since
    // this catalog isn't wired to any external API, it's just a field you
    // fill in yourself.
    detail: text("detail"),
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
// Not a DB enum — "positive"/"negative" is which fixed column group on
// `days` a person slot belongs to (positivePersonNId vs negativePersonNId),
// not a stored value, now that day_people is gone in favor of those columns.
export type PersonValence = "positive" | "negative";
export type EntertainmentKind = (typeof entertainmentKindEnum.enumValues)[number];
