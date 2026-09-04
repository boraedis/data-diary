import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
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

// entertainment_kind used to be a fixed pgEnum here (movie/tvshow/sport/
// book/game) — replaced by the entertainmentKinds table below so a user can
// add their own "neutral" kinds (see that table's comment) without a schema
// migration for every one. The five original enum values still exist, just
// as seeded rows with isSystem = true.

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
  // Plain free-text strings matched by name against the sleepLocationTypes/
  // sleepLocationSubtypes catalog below (issue #59), not FKs — same
  // free-text-but-catalog-backed relationship as places.category/subcategory
  // has with placeCategories/placeSubcategories.
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

// --- Exercise subtypes (catalog, scoped per category) ----------------------
// Legacy's `searchs/exercise_subtypes`: a real catalog, keyed by category
// name -> array of subtype strings (e.g. distance: "Outdoor", "Treadmill";
// strength: "Barbell", "Dumbbell", "Machine"), backing the workout entry
// form's subtype dropdown. `workouts.subtype` above is (and stays) free
// text — it was carried forward from the Phase 3 migration dry run before
// this catalog was reachable, and every historical value already in it
// would need to match a catalog entry to switch it to an FK. This table is
// the real maintained list for a dropdown/autocomplete; wiring the entry
// form to validate against it is a frontend follow-up, not enforced here.
export const exerciseSubtypes = pgTable(
  "exercise_subtypes",
  {
    id: serial("id").primaryKey(),
    category: exerciseCategoryEnum("category").notNull(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("exercise_subtypes_category_name_idx").on(table.category, table.name)]
);

// --- Exercise focus / subfocus (catalog + many-to-many tagging) -----------
// Legacy's `searchs/exercise_focuses` ({focusName: [subfocusName, ...]})
// plus each exercise doc carrying an array of {focus, subfocus, label} —
// a classification axis entirely orthogonal to category (e.g. an exercise
// can be tagged focus "Legs" / subfocus "Quads"). `label` in the legacy
// shape read as a per-assignment display override, carried forward here as
// an optional free-text field on the link row rather than dropped.
export const exerciseFocuses = pgTable("exercise_focuses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const exerciseSubfocuses = pgTable(
  "exercise_subfocuses",
  {
    id: serial("id").primaryKey(),
    focusId: integer("focus_id")
      .notNull()
      .references(() => exerciseFocuses.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("exercise_subfocuses_focus_name_idx").on(table.focusId, table.name)]
);

// A many-to-many link, not a column on `exercises` — an exercise can carry
// more than one focus/subfocus pair (legacy stored this as an array on the
// exercise doc). Cascades with the exercise itself on delete since this is
// just orthogonal tagging metadata, not something worth blocking a delete
// over the way workouts.exerciseId (real usage) does.
export const exerciseFocusLinks = pgTable(
  "exercise_focus_links",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    focusId: integer("focus_id")
      .notNull()
      .references(() => exerciseFocuses.id, { onDelete: "restrict" }),
    subfocusId: integer("subfocus_id").references(() => exerciseSubfocuses.id, { onDelete: "restrict" }),
    label: text("label"),
  },
  (table) => [index("exercise_focus_links_exercise_id_idx").on(table.exerciseId)]
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

// --- Tags (people) ---------------------------------------------------------
// Legacy's `searchs/people_extras.tags` turned out to be a real catalog
// (tag name -> hex color), not a scalar per person — each person doc stored
// the tag's *name* as a plain string (max one tag per person), and renaming
// a tag meant rewriting every member's document. Rebuilt here as a real
// table with `people.tagId` as a proper FK instead: renaming/recoloring a
// tag is now a single UPDATE on this row, no member-cascade needed. Legacy's
// delete-tag and merge-tags were both dead/commented-out code (confirmed
// while researching this) — NOT ported as-is; delete here is a real
// block-if-has-members operation (onDelete: "restrict"), same pattern as
// every other catalog's usage-checked delete.
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"), // hex, e.g. "#AFAFAF" — legacy's only other tag attribute
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Place categories / subcategories (catalog) -----------------------------
// Legacy's `searchs/place_categories`: {categoryName: [subcategoryName,
// ...]} — a two-level, fully user-editable taxonomy. Subcategories are
// scoped to their category via a real table + FK (not a second free array)
// so the same subcategory name can mean different things under different
// categories without collision. `places.category`/`places.subcategory`
// below stay plain free-text strings rather than FKs into these tables —
// that's not a shortcut, it's exactly how legacy stored them on a place doc
// too (confirmed: never a doc reference or ID, always a denormalized
// string copied from this catalog). These tables are the maintained list a
// picker/autocomplete reads from and new entries get added to; nothing
// here enforces that a place's stored category/subcategory string still
// matches a live catalog row, same as legacy.
export const placeCategories = pgTable("place_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const placeSubcategories = pgTable(
  "place_subcategories",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => placeCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("place_subcategories_category_name_idx").on(table.categoryId, table.name)]
);

// --- Metro areas -------------------------------------------------------------
// Legacy's `searchs/metros` ({name, municipalities: [], country, alias}) —
// `municipalities` was a hand-maintained denormalized array of place names;
// dropped here since it's just "places where metroId = this metro", a
// reverse FK query, not a field anything needs to write. Legacy also
// hardcoded a literal category=="Region" && subcategory=="Municipality"
// string match to decide when to show the metro picker in its UI — that's
// a frontend concern, not enforced at this layer; any place can carry a
// metroId regardless of its category/subcategory strings.
export const metros = pgTable("metros", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  country: text("country"),
  alias: text("alias"),
});

// --- Sleep location types / subtypes (catalog) ------------------------------
// Backs days.sleepLocationType/sleepLocationSubtype (see the `days` table
// comment) the same way placeCategories/placeSubcategories above backs
// places.category/subcategory: a real, maintained two-level taxonomy that a
// picker reads from and "+ New" adds to, while the day's own columns stay
// plain free-text strings matched by name, not FKs — same reasoning as
// places' category/subcategory (issue #59).
export const sleepLocationTypes = pgTable("sleep_location_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const sleepLocationSubtypes = pgTable(
  "sleep_location_subtypes",
  {
    id: serial("id").primaryKey(),
    typeId: integer("type_id")
      .notNull()
      .references(() => sleepLocationTypes.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("sleep_location_subtypes_type_name_idx").on(table.typeId, table.name)]
);

// --- Entertainment location types (catalog) ---------------------------------
// Backs the `locationType` free-text column shared by movieWatches,
// tvEpisodeWatches, bookReadingSessions, sportsWatches, and gameSessions
// below — same free-text-matched-by-name relationship as
// sleepLocationTypes above, just flat (one level) since none of those five
// columns has a subtype (issue #59).
export const entertainmentLocationTypes = pgTable("entertainment_location_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

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
// separate rule) plus an optional single tag (see `tags` above); places by
// an alias plus name.
export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  nicknames: text("nicknames").array().notNull().default([]),
  birthdate: date("birthdate", { mode: "string" }),
  gender: text("gender"),
  tagId: integer("tag_id").references(() => tags.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Places' hierarchy is a real, arbitrary-depth self-referencing tree.
// `parentId` is still the single source of truth for where a place sits in
// the tree (ancestry/descendants can always be re-derived from it — see
// getPlaceAncestry/getPlaceDescendantIds in src/lib/days.ts) — but unlike
// the original design here, `idPath`/`namePath` below ARE a maintained,
// denormalized materialization of that ancestry, kept in sync on every
// create/update (see buildPlacePath/cascadePlacePaths in src/lib/days.ts).
// This reintroduces exactly the "recursively rewrite every descendant on
// move" cost the original comment here argued against — deliberately, so
// path search and display don't need a live recursive walk. Existing rows
// need a one-time backfill (scripts/backfill-place-paths.mjs) before these
// are populated. `onDelete: "restrict"` on parentId means a place with
// children can't be deleted until they're moved or deleted first (mirrored
// in getPlaceUsage's usage check).
//
// `name` is deliberately NOT globally unique (2026-08-29 change) — real
// geography routinely reuses a name at two different hierarchy levels (an
// Emirate "Dubai" containing a City "Dubai"; a state and its capital city
// sharing a name; etc.), and a plain `unique(name)` made that unrepresentable:
// migrate-history.mjs's `on conflict (name)` upsert silently collapsed every
// such pair into one row, which then corrupted parentId into a
// self-reference the moment the hierarchy pass tried to link parent and
// child through what was now the same row (see scripts/split-duplicate-
// places.mjs, written to detect and repair exactly that). What IS still
// guarded against is the same name appearing twice at the *same* spot in
// the tree — createPlaceCatalogEntry's own dedup-on-create now targets
// (name, parentId) instead of name alone (see places_name_parent_id_idx
// below). Two different root-level (parentId IS NULL) places sharing a name
// aren't caught by this index — Postgres treats every NULL parentId as
// distinct for uniqueness purposes — but that's an intentionally rare edge
// case (two countries with the same name), not the common Region/City
// pattern this change exists for.
export const places = pgTable(
  "places",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    alias: text("alias"),
    address: text("address"),
    category: text("category"),
    subcategory: text("subcategory"),
    parentId: integer("parent_id").references((): AnyPgColumn => places.id, { onDelete: "restrict" }),
    // Free-text label for what this place's children are called, e.g.
    // "State", "Neighborhood" — legacy's per-node `subregion_name`, only
    // meaningful on a place that actually has descendants.
    subregionName: text("subregion_name"),
    // Hex color — legacy only ever set this on top-level ("country") places,
    // purely for UI color-coding; not enforced at this layer.
    color: text("color"),
    // "<id>/<id>/.../<id>/" from root to self inclusive, e.g. "3/17/42/108/".
    // "<name>/<name>/.../<name>/" from root to self inclusive, e.g.
    // "USA/Georgia/Atlanta/Midtown/" — the human-readable form, used for
    // search and display. Both null until backfilled/first saved.
    idPath: text("id_path"),
    namePath: text("name_path"),
    metroId: integer("metro_id").references(() => metros.id, { onDelete: "set null" }),
    // Geocoded once when `address` is first set, and only re-geocoded when
    // `address` actually changes (see geocodePlaceIfNeeded in
    // src/lib/catalog-admin.ts) — legacy re-geocoded on every single edit
    // regardless of what changed, burning a Maps API call every save; fixed
    // here rather than carried forward.
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("places_name_parent_id_idx").on(table.name, table.parentId)]
);

// --- entertainment_catalog / entertainment_entries ------------------------
// Same catalog-not-free-text shape as people/places/exercises: what you
// consumed is picked from a maintained (kind, title) catalog via the "+
// New" flow, not typed fresh every time. Deliberately still lightweight
// compared to the legacy app's five full catalog-referencing entertainment
// shapes (movies/tvshows/sports/books/games each had their own schema and
// external catalogs) — that's real catalog-domain work already scoped as
// Phase 5. This just needs "what, and for how long" until then.
// The five kinds this app has a real, dedicated domain for (movies,
// tvShows, sports, books, games below) — plus whatever "neutral" kinds a
// user adds through the manage-entertainment "+ New kind" flow for
// everything else (name only, no dedicated table). System rows are seeded
// once (see scripts/migrate-entertainment-kinds.mjs) and marked isSystem so
// the generic entertainmentCatalog below can refuse to let a NEW entry be
// created against one — those five already have their own catalogs and
// entry flows (TMDB, Google Books, the sport/league/team hierarchy); a
// second, disconnected "movie" row here would just fragment the data. Existing
// historical entertainmentCatalog rows that predate those dedicated
// tables (back when this generic catalog was the only place any
// entertainment got logged) keep referencing a system kind row here — only
// creating new ones against a system kind is blocked (see
// createEntertainmentCatalogEntry in src/lib/days.ts). isSystem also means
// "not user-deletable" — see deleteEntertainmentKindEntry in
// src/lib/catalog-admin.ts.
export const entertainmentKinds = pgTable("entertainment_kinds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entertainmentCatalog = pgTable(
  "entertainment_catalog",
  {
    id: serial("id").primaryKey(),
    kindId: integer("kind_id")
      .notNull()
      .references(() => entertainmentKinds.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    // Free-text disambiguator (a year, an author, a platform, whatever tells
    // two same-titled entries apart) — the legacy app got this for free from
    // TMDB lookups (release_date) or catalog fields (books' authors); since
    // this catalog isn't wired to any external API, it's just a field you
    // fill in yourself.
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("entertainment_catalog_kind_title_idx").on(table.kindId, table.title)]
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
    // Free text matched by name against entertainmentLocationTypes (issue
    // #61) — same relationship every other kind's locationType column has
    // with that catalog. Replaces the old free-form `notes` field (dropped,
    // not renamed — issue #61 narrows this kind down to "just duration and
    // where," matching the fields every other kind already carries).
    locationType: text("location_type"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("entertainment_entries_date_idx").on(table.date)]
);

// --- Entertainment: movies & TV shows -------------------------------------
// Phase 5's first real entertainment domain — added alongside
// entertainmentCatalog/entertainmentEntries above rather than replacing
// them yet; those stay live until the new per-kind entry forms/routes are
// built and swapped over, so the app keeps building in the meantime. See
// REBUILD_PLAN.md for the staged rollout.
//
// Per your call, ported at full parity with the legacy app rather than
// simplified: real TMDB (themoviedb.org) metadata lookups on add (poster
// art, genres, runtime), and for TV, true episode-by-episode watch
// tracking rather than show-level-only. Needs a `TMDB_API_KEY` env var —
// TMDB's API is free to use but does require signing up for a key; the
// legacy app hardcoded one directly in client-side JS (findable in its git
// history), which is deliberately not being carried forward — see the
// Phase 6 cleanup note on rotating/not-repeating exposed secrets.
export const movies = pgTable("movies", {
  id: serial("id").primaryKey(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  releaseDate: date("release_date", { mode: "string" }),
  runtimeMinutes: integer("runtime_minutes"),
  posterPath: text("poster_path"),
  genres: text("genres").array().notNull().default([]),
  // Franchise name, from TMDB's belongs_to_collection — optional.
  collectionName: text("collection_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per watch, including rewatches — replaces the legacy's
// day-array-plus-separate-per-day-watch-count-map duplication (`searchs/
// media[id].watches: {date: count}`, kept in sync by hand on every save).
// A rewatch count here is just `count(*) group by movie_id`, nothing to
// keep in sync.
export const movieWatches = pgTable(
  "movie_watches",
  {
    id: serial("id").primaryKey(),
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    rating: smallint("rating"), // 1-10, matches the legacy slider
    // Plain free-text string matched by name against the
    // entertainmentLocationTypes catalog (issue #59) — not an FK, same
    // free-text-but-catalog-backed relationship days.sleepLocationType has
    // with sleepLocationTypes.
    locationType: text("location_type"),
    // Defaults from movies.runtimeMinutes client-side but is independently
    // editable/storable per watch (issue #61) — a rewatch might run long,
    // get paused and resumed, etc., so it's its own column rather than
    // always trusting the catalog's runtime.
    durationMinutes: integer("duration_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("movie_watches_date_idx").on(table.date)]
);

// Watchlist + top-10 ranking (issue #124) — re-added after being dropped in
// #79 (dead weight until there was a real UI for them; see that issue's
// migration-script comment for the exact legacy Firestore shapes this was
// backfilled from: `entertainment/watchlists.movies` was a map of {movieId:
// dayNumberAdded}, `entertainment/rankings.movies` an ordered array of up to
// 10 movie ids). `onDelete: "restrict"` matches movieWatches above — a
// movie's watchlist/ranking membership counts as "in use" the same way a
// watch does, so deleting the movie needs the entry removed here first
// rather than silently vanishing.
export const movieWatchlist = pgTable("movie_watchlist", {
  movieId: integer("movie_id")
    .primaryKey()
    .references(() => movies.id, { onDelete: "restrict" }),
  addedAt: date("added_at", { mode: "string" }),
});

// rank is the primary key (1-10, enforced app-side) rather than a plain
// serial id — legacy's ranking was always "the current top 10, in order,"
// never a history, and a replace-all save (same pattern as
// entertainment_entries/movie_watches per-day satellites) is simplest when
// position IS the identity of the row.
export const movieRankings = pgTable("movie_rankings", {
  rank: smallint("rank").primaryKey(),
  movieId: integer("movie_id")
    .notNull()
    .references(() => movies.id, { onDelete: "restrict" }),
});

export const tvShows = pgTable("tv_shows", {
  id: serial("id").primaryKey(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  posterPath: text("poster_path"),
  genres: text("genres").array().notNull().default([]),
  status: text("status"), // TMDB status string, e.g. "Ended" / "Returning Series"
  // Whether you're still actively following this show — the legacy
  // "interested" toggle, flips off (with a date) once you drop a show.
  interested: boolean("interested").notNull().default(true),
  uninterestedDate: date("uninterested_date", { mode: "string" }),
  lastRefreshed: date("last_refreshed", { mode: "string" }),
  nextEpisodeDate: date("next_episode_date", { mode: "string" }),
  nextEpisodeSeason: integer("next_episode_season"),
  nextEpisodeNumber: integer("next_episode_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Episode metadata catalog — one row per known episode, not per watch (see
// tvEpisodeWatches below for that).
export const tvEpisodes = pgTable(
  "tv_episodes",
  {
    id: serial("id").primaryKey(),
    showId: integer("show_id")
      .notNull()
      .references(() => tvShows.id, { onDelete: "cascade" }),
    tmdbEpisodeId: integer("tmdb_episode_id").notNull().unique(),
    season: integer("season").notNull(),
    episode: integer("episode").notNull(),
    name: text("name"),
    airDate: date("air_date", { mode: "string" }),
    runtimeMinutes: integer("runtime_minutes"),
  },
  (table) => [index("tv_episodes_show_id_idx").on(table.showId)]
);

// One row per watch, including rewatches — replaces the legacy's
// per-episode `watches: {date: count}` map, same reasoning as
// movieWatches above. `date` is nullable specifically for the legacy
// app's "I watched this at some point before I started tracking" bulk
// mark (its special "legacy" pseudo-date key): a null date means "watched,
// exact date unknown" rather than "not watched" — absence of a row at all
// is what "not watched" means here.
export const tvEpisodeWatches = pgTable(
  "tv_episode_watches",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id")
      .notNull()
      .references(() => tvEpisodes.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).references(() => days.date, { onDelete: "cascade" }),
    locationType: text("location_type"),
    // Same reasoning as movieWatches.durationMinutes (issue #61) — defaults
    // from tvEpisodes.runtimeMinutes client-side, independently editable.
    durationMinutes: integer("duration_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tv_episode_watches_episode_id_idx").on(table.episodeId),
    index("tv_episode_watches_date_idx").on(table.date),
  ]
);

// --- Entertainment: books ---------------------------------------------
// Real Google Books metadata on add (needs a `GOOGLE_BOOKS_API_KEY` env
// var — same call as movies/TV: free API, but the legacy app's hardcoded
// key isn't being carried forward). Deliberately NOT stored: a cached
// "bookmark" (current page) or completions counter — the legacy app kept
// both in sync by hand (the completions count via a full rescan of every
// day's entertainment log on every relevant save). Both are trivial to
// compute on read in Postgres instead (current page = `max(end_page)`
// ordered by date since the last completed session; completions =
// `count(*) where completed`), so there's nothing to keep in sync at all.
export const books = pgTable("books", {
  id: serial("id").primaryKey(),
  googleBooksId: text("google_books_id").notNull().unique(),
  title: text("title").notNull(),
  authors: text("authors").array().notNull().default([]),
  publisher: text("publisher"),
  // Google Books returns partial dates ("1997", "1997-06") as well as full
  // ones — free text rather than a real date column since it's not always
  // a complete date.
  publishedDate: text("published_date"),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  pageCount: integer("page_count"),
  categories: text("categories").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookReadingSessions = pgTable(
  "book_reading_sessions",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    startPage: integer("start_page"),
    endPage: integer("end_page"),
    // String "true"/"false" in the legacy app (a radio field) — a real
    // boolean here, no reason to carry that forward.
    completed: boolean("completed").notNull().default(false),
    locationType: text("location_type"),
    durationMinutes: integer("duration_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("book_reading_sessions_date_idx").on(table.date),
    index("book_reading_sessions_book_id_idx").on(table.bookId),
  ]
);

// Watchlist ("readlist") + top-10 ranking (issue #124), same shape and
// restore reasoning as movieWatchlist/movieRankings above. Legacy's
// `entertainment/watchlists.books` was a plain array of book ids with no
// per-entry added-date (unlike movies' map) — addedAt is nullable here for
// exactly that reason, populated going forward but left null for anything
// migrated from that array. The real legacy data for both books tables
// turned out to be empty at migration time (its own watchlist/ranking edit
// pages had a wrong-namespace bug — see issue #124 — so nothing was ever
// successfully saved through them), so there was nothing to backfill.
export const bookWatchlist = pgTable("book_watchlist", {
  bookId: integer("book_id")
    .primaryKey()
    .references(() => books.id, { onDelete: "restrict" }),
  addedAt: date("added_at", { mode: "string" }),
});

export const bookRankings = pgTable("book_rankings", {
  rank: smallint("rank").primaryKey(),
  bookId: integer("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "restrict" }),
});

// --- Entertainment: sports ---------------------------------------------
// Fully manual catalog, no external API — the historical survey found this
// domain genuinely complete and well-used in the legacy app (unlike games
// below), so it's ported closely: sport -> league -> team, all user-entered
// via "+ New" flows like people/places/exercises. Seasons stay free text on
// the log rather than getting their own catalog table — in the legacy app
// it's just a label list scoped to a league (`leagues[name].seasons`), not
// a real entity with its own attributes, so a whole table would be
// overhead a label doesn't need. Divisions started the same way but got
// promoted to a real per-league catalog in issue #71 (see sportsDivisions
// below) — teams needed to actually pick a division/conference from a
// maintained list scoped to their league, not just type one in free-hand.
export const sports = pgTable("sports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isTeamSport: boolean("is_team_sport").notNull().default(true),
});

export const sportsLeagues = pgTable(
  "sports_leagues",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type"),
  },
  (table) => [uniqueIndex("sports_leagues_sport_id_name_idx").on(table.sportId, table.name)]
);

export const sportsTeams = pgTable(
  "sports_teams",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    leagueId: integer("league_id").references(() => sportsLeagues.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    alias: text("alias"),
    // The legacy field was named `city` for team sports and (via an actual
    // typo, "nationaltity") for individual-athlete sports where a "team" is
    // really just a person — one honestly-named free-text field here
    // instead of carrying the typo or the dual-meaning-by-sport-type
    // ambiguity forward.
    homeLocation: text("home_location"),
    color: text("color"),
    // Matched by name against the sportsDivisions catalog below (issue
    // #71), same free-text-but-catalog-backed relationship as
    // sportsWatches.season has with sportsSeasons — not an FK, since a
    // division scoped to the wrong league would otherwise need its own
    // migration path rather than just picking a different string.
    division: text("division"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sports_teams_sport_id_name_idx").on(table.sportId, table.name)]
);

export const sportsWatches = pgTable(
  "sports_watches",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "restrict" }),
    leagueId: integer("league_id").references(() => sportsLeagues.id, { onDelete: "set null" }),
    season: text("season"),
    gameType: text("game_type"),
    homeTeamId: integer("home_team_id").references(() => sportsTeams.id, { onDelete: "set null" }),
    awayTeamId: integer("away_team_id").references(() => sportsTeams.id, { onDelete: "set null" }),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    watchedLive: boolean("watched_live").notNull().default(false),
    durationMinutes: integer("duration_minutes"),
    locationType: text("location_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sports_watches_date_idx").on(table.date)]
);

// --- Sports seasons / game types (catalog) ----------------------------------
// Backs sportsWatches.season/gameType (issue #61) the same way
// sleepLocationTypes/entertainmentLocationTypes back their own free-text
// columns: both stay plain strings on sportsWatches, matched by name, not
// FKs. Seasons are scoped to an existing league (a season name like
// "2023-24" only means something within a specific league), so this
// mirrors placeSubcategories/sleepLocationSubtypes — a child row under an
// already-real parent catalog — rather than needing a second top-level
// table the way sleep's type/subtype pair did.
export const sportsSeasons = pgTable(
  "sports_seasons",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => sportsLeagues.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("sports_seasons_league_id_name_idx").on(table.leagueId, table.name)]
);

// Backs sportsTeams.division (issue #71) — exact same shape as
// sportsSeasons above: scoped to a league (a division/conference name like
// "AFC East" or "Atlantic" only means something within a specific league),
// child row under an already-real parent catalog. "Division" and
// "conference" are treated as the same concept here (different leagues use
// different words for it) rather than two separate catalogs.
export const sportsDivisions = pgTable(
  "sports_divisions",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => sportsLeagues.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("sports_divisions_league_id_name_idx").on(table.leagueId, table.name)]
);

// Flat, unscoped — "regular season"/"playoffs"/"exhibition" means the same
// thing across every sport/league, unlike season.
export const sportsGameTypes = pgTable("sports_game_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

// --- Entertainment: games ---------------------------------------------
// Kept intentionally minimal — the historical survey found the legacy games
// domain was effectively a stub: its catalog-edit function called an API
// method that was never defined, and a copy-pasted stand-in for it silently
// clobbered the *books* edit function instead (wrong-namespace bug); its
// browse UI was leftover sports-catalog code, never adapted. There's no
// real intended richer design underneath to reverse-engineer, so this was
// just enough to log "played X for N minutes" — same treatment as
// finance/todo/goals in spirit, just not fully dropped since logging a
// game session is at least a working, real feature today.
//
// Issue #68 built the missing entry surface on top of this stub: `type`/
// `subtype` are matched by name against gameCategories/gameSubcategories
// below (same free-text-matched-by-name relationship as places.category/
// subcategory), and `deviceType` against gameDeviceTypes, same as every
// other catalog-backed-but-free-text column in this file.
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type"),
  subtype: text("subtype"),
});

export const gameSessions = pgTable(
  "game_sessions",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" })
      .notNull()
      .references(() => days.date, { onDelete: "cascade" }),
    durationMinutes: integer("duration_minutes"),
    // Matched by name against gameDeviceTypes below — a *category* of
    // device ("Console", "PC"), not a specific physical device, hence
    // "type" in both the column and catalog name (issue #75 follow-up).
    deviceType: text("device_type"),
    locationType: text("location_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("game_sessions_date_idx").on(table.date)]
);

// --- Game categories / subcategories (catalog) -------------------------
// Backs games.type/games.subtype the same two-level way placeCategories/
// placeSubcategories backs places.category/subcategory above — a real,
// maintained taxonomy a picker reads from and "+ New" adds to, while the
// game catalog row itself keeps type/subtype as plain free-text strings
// matched by name, not FKs (issue #68).
export const gameCategories = pgTable("game_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const gameSubcategories = pgTable(
  "game_subcategories",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => gameCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("game_subcategories_category_name_idx").on(table.categoryId, table.name)]
);

// --- Game device types (catalog) -----------------------------------------
// Backs gameSessions.deviceType the same flat, one-level way
// entertainmentLocationTypes backs locationType (issue #68) — a category of
// device ("Console", "PC", "Phone"), not a specific physical device, hence
// "device type" rather than "device" (renamed in the issue #75 follow-up,
// before this table had any real usage to migrate).
export const gameDeviceTypes = pgTable("game_device_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

// --- Music: artists / genres (catalogs) -------------------------------
// Issue #76: the artist/album/genre enrichment layer noted below as
// deliberately-not-ported is now being built, resolved at import time via
// the Spotify Web API (src/lib/spotify.ts) rather than hand-curated —
// legacy's genre/subgenre pair was set once per artist and never revisited
// because it required manual research per artist; hitting Spotify's own
// artist-genre data at import time removes that manual step entirely for
// the specific-genre layer.
//
// Spotify's artist genre data is a flat bag of narrow tags (e.g.
// "alternative r&b", "conscious hip hop"), not a genre/subgenre tree —
// there is no API-derivable mapping from those tags up to broad buckets
// like "Rock" or "Pop". So this is two real levels, only one of which is
// automatable: `genres` rows are the specific Spotify tags, many-to-many
// with artists via `artistGenres` (an artist can and usually does carry
// several); `genreGroups` is the broad, hand-curated bucket a specific
// genre optionally belongs to (assigned via a catalog-admin screen, same
// "+ New" / assign flow as tags on people). Color lives on the group, not
// the specific genre — Spotify's tag vocabulary runs into the hundreds,
// far past what a legible categorical chart palette
// (src/lib/viz/color.ts's 5 fixed slots) can represent, while the
// hand-curated groups are exactly the small, stable set a chart needs.
export const genreGroups = pgTable("genre_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"), // hex, e.g. "#AFAFAF" — same convention as tags.color
});

export const genres = pgTable("genres", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // the raw Spotify genre tag
  groupId: integer("group_id").references(() => genreGroups.id, { onDelete: "set null" }),
});

// Artists get a real catalog (unlike movies/tvShows' plain `genres: text[]`
// column) because listens need to resolve to *one* artist identity across
// however many name spellings Spotify's export uses for it — `aliases`
// mirrors `people.nicknames`'s shape and role: alternate names an import
// or a manual merge can attach without renaming the canonical row.
// `spotifyId` is set the first time an artist is resolved via the Spotify
// API and used to skip re-searching on every later import.
export const artists = pgTable("artists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  aliases: text("aliases").array().notNull().default([]),
  spotifyId: text("spotify_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artistGenres = pgTable(
  "artist_genres",
  {
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    genreId: integer("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("artist_genres_artist_genre_idx").on(table.artistId, table.genreId)]
);

// --- Music: podcasts (catalog) ------------------------------------------
// Issue #76: the Spotify export bundles podcast listens in with track
// listens (same file, distinguished by episode_show_name being set instead
// of a track/artist). Podcasts get their own catalog, same reasoning as
// artists above (resolve the many episode-show-name spellings to one row),
// but genre has no equivalent here — Spotify's API doesn't expose a
// podcast taxonomy the way it does artist genres — so this is "a simple
// category catalog" per the issue, hand-curated like place categories, not
// auto-populated.
export const podcastCategories = pgTable("podcast_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const podcastShows = pgTable("podcast_shows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  categoryId: integer("category_id").references(() => podcastCategories.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Music (Spotify listen history) ---------------------------------------
// Architecturally separate from the five kinds above: the legacy app never
// logged listens as part of day-to-day entry at all — it bulk-read raw
// Spotify "Extended Streaming History" export JSON files fresh at
// chart-render time, nothing persisted per-listen in Firestore. This table
// is the persisted version of that export data, populated by an in-app
// upload/import flow (per your call — not a one-off migration script) —
// there's no day-entry form for this, just an import page elsewhere in the
// app.
//
// The raw uploaded export file itself is never stored anywhere (not on
// disk, not in Postgres, not in a blob bucket) — the import route parses
// it in memory and discards it once these rows are written. There's no
// storage layer in this app (Neon Postgres only, no S3/Blob dependency)
// and nothing downstream needs the original JSON once its fields are
// extracted: re-uploading the same or an overlapping export is already a
// safe no-op via the dedupe index below, so there's no "reprocess the
// original file" scenario the raw bytes would be needed for either.
//
// A listen row is written once at import time and never edited after —
// there's deliberately no PATCH route for this table (unlike every other
// catalog here). It's a historical record of what actually got streamed;
// "fixing" a row would mean falsifying that record. If an import resolved
// the wrong artist/show, the fix is correcting the `artists`/`podcastShows`
// catalog row (or its aliases) so future imports resolve correctly, not
// editing the listen.
export const musicListens = pgTable(
  "music_listens",
  {
    id: serial("id").primaryKey(),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
    msPlayed: integer("ms_played").notNull(),
    trackName: text("track_name"),
    artistId: integer("artist_id").references(() => artists.id, { onDelete: "set null" }),
    albumName: text("album_name"),
    // Set instead of trackName/artistId for podcast episodes, matching the
    // Spotify export's own shape (episode_name/episode_show_name).
    episodeName: text("episode_name"),
    podcastShowId: integer("podcast_show_id").references(() => podcastShows.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("music_listens_played_at_idx").on(table.playedAt),
    index("music_listens_artist_id_idx").on(table.artistId),
    index("music_listens_podcast_show_id_idx").on(table.podcastShowId),
    // Re-uploading the same export (or overlapping exports — Spotify
    // splits a year into multiple numbered files once it's large enough,
    // and boundary-adjacent pairs like 2019/2019_1 are exactly the kind of
    // file split that could double-count a listen near the boundary)
    // should be a safe no-op, not duplicate rows — the import route uses
    // ON CONFLICT DO NOTHING against this index. Postgres unique indexes
    // never treat two NULLs as equal, and exactly one of trackName/
    // episodeName is always null (music vs. podcast row) — a plain
    // multi-column index on both would never detect a podcast-row
    // conflict at all (every podcast row has trackName = NULL). The
    // coalesce collapses them into one non-null discriminator so both
    // kinds actually dedupe.
    uniqueIndex("music_listens_dedupe_idx").on(
      table.playedAt,
      sql`coalesce(${table.trackName}, ${table.episodeName})`,
      table.msPlayed
    ),
  ]
);

// --- Profile: owner identity + timelines -----------------------------------
// The legacy app's `searchs/profile` doc: three arrays (occupation,
// residence, relationship) plus several personal facts (name, birthdate,
// diary start date) that had no home at all in the old app — those were
// hardcoded as literals scattered across 7+ files instead (see #11's scope-
// expansion comment). Modeled as separate relational tables, one per
// timeline type, rather than a single polymorphic `profile_entries` table
// with a `type` discriminant — consistent with how every other multi-shape
// domain in this schema (movies/tvShows/sports/books, not one shared
// "entertainment" table) gets its own table rather than a shared one with
// nullable per-type columns.
//
// All three timelines are optionally open-ended — a null `end` means
// "ongoing" — matching how legacy and every consumer (charts, the
// dashboard's Profile block) already treat a missing end date.

// Single-row settings, not a real multi-row table — this app has exactly
// one authenticated identity (the APP_PASSWORD session cookie), not
// multiple users, so there's nothing to key rows by. `id` is pinned to 1
// and every read/write targets that one row (see getProfileSettings/
// upsertProfileSettings in src/lib/profile.ts); modeled as a table instead
// of a single hardcoded row so it's still just a normal upsert, no
// migration-time seed required. Timezone was explicitly cut from this
// issue's scope (see the issue thread) — legacy's hardcoded
// 'Europe/London' was a band-aid for date-display formatting, not a real
// requirement, and doesn't belong on a single-value "primary timezone"
// field for someone who moves around.
export const profileSettings = pgTable("profile_settings", {
  id: smallint("id").primaryKey().default(1),
  name: text("name"),
  birthdate: date("birthdate", { mode: "string" }),
  diaryStartDate: date("diary_start_date", { mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Project-level settings for the public landing page (#12/#82) — the
// project's own identity (name, tagline, goal blurb), not the diary
// owner's personal identity above. Kept as a separate table rather than
// folded onto profileSettings since it's conceptually different data
// (about the project, not about the person) and is safe to expose to
// anonymous visitors in full — profileSettings never is. Same
// single-row-table pattern as profileSettings above: id pinned to 1, plain
// upsert, no seed migration needed.
export const projectSettings = pgTable("project_settings", {
  id: smallint("id").primaryKey().default(1),
  name: text("name"),
  tagline: text("tagline"),
  goalsSummary: text("goals_summary"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Legacy shape: {position, company, place, name, start, end?, alias?,
// color?, roles?: [{position, start, end?}]}. `placeId` resolves against
// the existing `places` catalog (legacy's own `place` field derived from
// the same country/state/city hierarchy this table already models) rather
// than free text. `roles` is its own child table below, not a jsonb array
// — consistent with how this schema always reaches for a real child table
// over a jsonb blob when the nested data has its own identity and date
// range (see workoutSets, tvEpisodes, exerciseSubfocuses for the same
// call). onDelete: "set null" on placeId — losing the place shouldn't take
// the occupation entry down with it, same reasoning as workouts.locationId.
export const profileOccupations = pgTable(
  "profile_occupations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    position: text("position"),
    company: text("company"),
    placeId: integer("place_id").references(() => places.id, { onDelete: "set null" }),
    start: date("start", { mode: "string" }).notNull(),
    end: date("end", { mode: "string" }),
    alias: text("alias"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profile_occupations_start_idx").on(table.start)]
);

// One row per promotion/title-change within a single occupation entry —
// e.g. "Software Engineer" -> "Senior Software Engineer" at the same
// company, without treating that as two separate occupation entries.
export const profileOccupationRoles = pgTable(
  "profile_occupation_roles",
  {
    id: serial("id").primaryKey(),
    occupationId: integer("occupation_id")
      .notNull()
      .references(() => profileOccupations.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
    start: date("start", { mode: "string" }).notNull(),
    end: date("end", { mode: "string" }),
  },
  (table) => [index("profile_occupation_roles_occupation_id_idx").on(table.occupationId)]
);

// Legacy shape: {place, name, start, end?, alias?, color?}. `placeId` is
// notNull + onDelete: "restrict" (unlike occupation's optional/set-null
// place) — a residence entry without a place isn't really a residence
// entry, matching how legacy's residence.js always required one.
export const profileResidences = pgTable(
  "profile_residences",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    placeId: integer("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "restrict" }),
    start: date("start", { mode: "string" }).notNull(),
    end: date("end", { mode: "string" }),
    alias: text("alias"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profile_residences_start_idx").on(table.start)]
);

// Legacy shape: {id (person), name, start, end?, alias?, color?} — no
// status/type field (no "dating" vs "married" distinction), just a person
// and a date range. `personId` restricts on delete (same as every other
// people.id reference in this schema — days.positivePersonNId, etc.) so a
// person can't be removed from the catalog while a relationship entry
// still points at them.
export const profileRelationships = pgTable(
  "profile_relationships",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    start: date("start", { mode: "string" }).notNull(),
    end: date("end", { mode: "string" }),
    alias: text("alias"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profile_relationships_start_idx").on(table.start)]
);


// --- Convenience types -----------------------------------------------------
export type DayType = (typeof dayTypeEnum.enumValues)[number];
export type WorkLocationOption = (typeof workLocationEnum.enumValues)[number];
export type CommuteOption = (typeof commuteEnum.enumValues)[number];
export type WorkoutDataSource = (typeof workoutDataSourceEnum.enumValues)[number];
export type ExerciseCategory = (typeof exerciseCategoryEnum.enumValues)[number];
// EntertainmentKind (used to be derived from entertainmentKindEnum here)
// is gone along with the enum — see the entertainmentKinds table comment
// above `entertainmentCatalog`. A kind is now just a row (id, name), read
// via catalog-admin.ts's EntertainmentKindItem.
// Not a DB enum — "positive"/"negative" is which fixed column group on
// `days` a person slot belongs to (positivePersonNId vs negativePersonNId),
// not a stored value, now that day_people is gone in favor of those columns.
export type PersonValence = "positive" | "negative";
