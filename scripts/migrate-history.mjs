#!/usr/bin/env node
/**
 * Phase 3 — one-time historical migration from the legacy Firestore app
 * into this Postgres schema.
 *
 * WHY THIS IS A STANDALONE SCRIPT, NOT PART OF THE APP: it needs
 * firebase-admin (Firestore access, via the legacy service account key)
 * *and* a direct Postgres connection, neither of which the Next app itself
 * needs at runtime. It also needs to run from a machine with real network
 * access to both Firestore and Neon — the coding sandbox this was written
 * in has neither (confirmed: both registry.npmjs.org and
 * firestore.googleapis.com are unreachable from it), so this could only be
 * written and reasoned about from the legacy app's *source code*, never
 * run or tested against your real data. Treat the first run as a dry run
 * in spirit even once `--commit` is used — read the report it prints.
 *
 * SETUP (once):
 *   npm install --save-dev firebase-admin pg
 *
 * USAGE (run from the root of this repo, data-diary):
 *   FIREBASE_SERVICE_ACCOUNT=/path/to/Data_Diary_App/data-diary-1693-firebase-adminsdk-pj4m4-857cdc78cb.json \
 *   DATABASE_URL=postgres://... \
 *   node scripts/migrate-history.mjs [--commit] [--limit=N] [--only=<daynum>]
 *
 * Defaults to a DRY RUN: reads every relevant Firestore collection,
 * transforms it, and prints a full coverage/warnings report — but writes
 * NOTHING to Postgres. Pass --commit to actually write. Re-running with
 * --commit is safe (every write is an upsert / delete-then-reinsert keyed
 * by date), so it's fine to run once dry, adjust CONFIG below, and run
 * dry again before ever committing.
 *
 * --limit=N caps how many `days` documents are processed (fastest way to
 * sanity-check the transform logic and the report before a full run).
 * --only=<daynum> processes just one specific day doc (its Firestore doc
 * ID, e.g. --only=9500) — use this together with --commit and a few
 * `console.log`s if you need to debug one specific day in isolation.
 *
 * WHAT THIS DOES NOT MIGRATE, ON PURPOSE:
 *   - Entertainment (movies/tv/books/games/sports/music) — the legacy app's
 *     five real per-kind catalogs (TMDB ids, episode-level watch tracking,
 *     book page bookmarks) don't fit the lightweight kind+title+detail
 *     shape this rebuild has today. Revisit once Phase 5 rebuilds those
 *     catalogs for real; nothing is lost by waiting — it just stays in
 *     Firestore untouched.
 *   - Finance, todo, goals — no Postgres schema exists for these yet at
 *     all (Phase 5 territory), so there's nothing to migrate them into.
 *
 * Workout `subtype` (e.g. "Barbell" vs "Dumbbell" vs "Machine" for the same
 * named exercise) IS migrated — a first dry run found it on effectively
 * every exercise in the catalog, so `workouts.subtype` was added to the
 * schema (it had been dropped, apparently by accident, during the Phase 2
 * catalog redesign) rather than silently losing that detail. See
 * `subtypesSeen` in the report below for coverage.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import admin from "firebase-admin";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CONFIG — read this before running. Everything below was inferred from the
// legacy app's *source* (EJS templates, entry/*.js), not from live data —
// this sandbox has no network path to Firestore. Marked per-item where it's
// a direct, verified match vs. a best-effort default you should sanity
// check against the dry-run report.
// ---------------------------------------------------------------------------

// Exercise category is NOT a fixed list in the legacy app — `searchs/
// exercise_categories` is a free-text, user-managed catalog (each category
// even has its own custom form-field config there). The new schema keeps a
// fixed 3-value enum for now on purpose (see the comment above
// exerciseCategoryEnum in src/db/schema.ts for the plan to outgrow this
// later). Map every real category name you have to whichever of the three
// fits closest. Leave this empty and run a dry run first — the report
// prints every category name actually found in `searchs/exercises`, so you
// don't have to guess blind.
const CATEGORY_MAP = {
  // Filled in from a real dry run (2026-08-23) — these are the actual three
  // category names in this account's searchs/exercises, nothing guessed.
  distance_exercise: "distance",
  weights: "strength",
  sport: "sport",
};

// VERIFIED directly against work.ejs's <option value="..."> — the legacy
// <select> only ever writes these exact strings, and they already match the
// Postgres enum (work_location_option) exactly. Left as an escape hatch
// only in case real data has stray values these forms no longer offer
// (manually-patched Firestore docs, an older form version, etc.) — add
// `'legacy value': 'home'` style entries here if the report flags any.
const WORK_LOCATION_ALIASES = {};

// VERIFIED against work.ejs — commute_option enum values match exactly.
const COMMUTE_ALIASES = {};

// VERIFIED against happiness.ejs — day_type enum values match exactly.
const DAY_TYPE_ALIASES = {};

// VERIFIED against weight.ejs / health.ejs: the legacy forms label these
// fields "kg" and "km" right in the UI, so no unit conversion is needed —
// straight copy.
const WEIGHT_UNIT_IS_KG = true;
const DISTANCE_UNIT_IS_KM = true;

// Epoch used by the legacy app's date2num/num2date (functions/views/entry/
// entry_functions.js) — the `days` collection's document IDs are day-offsets
// from this date. Only used as a fallback when a day doc is somehow missing
// its own `date` field (every day doc should have one, written as
// `date_cur.toDateString()` — see functions/views/entry/home.js).
const EPOCH = new Date(2000, 3, 20); // 2000/04/20, local time

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const LIMIT = (() => {
  const flag = args.find((a) => a.startsWith("--limit="));
  return flag ? parseInt(flag.split("=")[1], 10) : null;
})();
const ONLY = (() => {
  const flag = args.find((a) => a.startsWith("--only="));
  return flag ? flag.split("=")[1] : null;
})();

console.log(`\n=== Data Diary historical migration — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
if (!COMMIT) {
  console.log("(dry run — nothing will be written to Postgres; pass --commit to write)\n");
}

// ---------------------------------------------------------------------------
// Firestore + Postgres setup
// ---------------------------------------------------------------------------

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountPath) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT to the path of the legacy service account key JSON.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to your Neon Postgres connection string.");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(path.resolve(serviceAccountPath), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const fs = admin.firestore();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** JS Date -> "YYYY-MM-DD" using LOCAL date parts (never toISOString, which
 * can shift the day across a UTC boundary). */
function toDateColumn(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Legacy day docs store `date` as `new Date(...).toDateString()` (e.g.
 * "Wed Apr 20 2000") — parseable directly by `new Date(...)`. Falls back to
 * the daynum epoch if the field is ever missing/unparseable. */
function parseLegacyDate(dateField, daynum) {
  if (typeof dateField === "string" && dateField.trim()) {
    const d = new Date(dateField);
    if (!Number.isNaN(d.getTime())) return toDateColumn(d);
  }
  const n = parseInt(daynum, 10);
  if (Number.isFinite(n)) {
    const d = new Date(EPOCH);
    d.setDate(d.getDate() + n);
    return toDateColumn(d);
  }
  return null;
}

/** daynum -> JS Date, via the same epoch offset used everywhere else. Used
 * by migratePeople to synthesize a `created_at` timestamp from a person's
 * first-appearance daynum. */
function dateFromDaynum(daynum) {
  const d = new Date(EPOCH);
  d.setDate(d.getDate() + daynum);
  return d;
}

/** hh:mm string -> minutes-since-midnight, for comparing sleep/wake times. */
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** {hours, mins|minutes} -> flat minutes. Legacy is inconsistent about the
 * minutes key name (naps/phoneusage/laptopusage/instausage use `mins`;
 * work_duration uses `minutes`) — accept either. */
function flattenHM(obj) {
  if (!obj || typeof obj !== "object") return null;
  const hours = typeof obj.hours === "number" ? obj.hours : 0;
  const mins = typeof obj.mins === "number" ? obj.mins : typeof obj.minutes === "number" ? obj.minutes : 0;
  return hours * 60 + mins;
}

/** {hours, minutes, seconds} (any subset) -> flat minutes, rounded. Used for
 * workout exercise_duration, which the legacy `duration` field type stores
 * as whichever of the three sub-fields the category config enabled. */
function flattenDurationToMinutes(obj) {
  if (!obj || typeof obj !== "object") return null;
  const hours = typeof obj.hours === "number" ? obj.hours : 0;
  const minutes = typeof obj.minutes === "number" ? obj.minutes : 0;
  const seconds = typeof obj.seconds === "number" ? obj.seconds : 0;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  if (totalSeconds === 0 && hours === 0 && minutes === 0 && seconds === 0) return null;
  return Math.round(totalSeconds / 60);
}

/** {hours, minutes, seconds} (any subset) -> flat seconds, for a single
 * timed workout_sets row. */
function flattenDurationToSeconds(obj) {
  if (!obj || typeof obj !== "object") return null;
  const hours = typeof obj.hours === "number" ? obj.hours : 0;
  const minutes = typeof obj.minutes === "number" ? obj.minutes : 0;
  const seconds = typeof obj.seconds === "number" ? obj.seconds : 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total || null;
}

function normalizeEnumArray(raw, allowed, aliases, label, warnings) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    const lower = String(v).trim().toLowerCase();
    const mapped = aliases[v] ?? aliases[lower] ?? lower;
    if (allowed.has(mapped)) {
      out.push(mapped);
    } else {
      warnings.unmapped[label].add(String(v));
    }
  }
  return out;
}

function normalizeEnumValue(raw, allowed, aliases, label, warnings) {
  if (raw === undefined || raw === null || raw === "") return null;
  const lower = String(raw).trim().toLowerCase();
  const mapped = aliases[raw] ?? aliases[lower] ?? lower;
  if (allowed.has(mapped)) return mapped;
  warnings.unmapped[label].add(String(raw));
  return null;
}

const WORK_LOCATIONS = new Set(["home", "office", "cafe", "travel", "other"]);
const COMMUTES = new Set(["car", "carpool", "taxi", "public_transit", "bike", "walk", "other"]);
const DAY_TYPES = new Set(["work", "dayoff", "vacation", "travel", "sick", "jobless"]);

const POSITIVE_PERSON_COLUMNS = [
  "positive_person_1_id",
  "positive_person_2_id",
  "positive_person_3_id",
  "positive_person_4_id",
  "positive_person_5_id",
  "positive_person_6_id",
  "positive_person_7_id",
];
const NEGATIVE_PERSON_COLUMNS = ["negative_person_1_id", "negative_person_2_id", "negative_person_3_id"];
const PLACE_COLUMNS = ["place_1_id", "place_2_id"];
const SUB_NAMES = ["A", "W", "C", "L", "Ni", "NO", "Ad", "D", "K"];
const SUB_COLUMNS = ["sub_a", "sub_w", "sub_c", "sub_l", "sub_ni", "sub_no", "sub_ad", "sub_d", "sub_k"];

// ---------------------------------------------------------------------------
// Report accumulator — printed at the end regardless of dry-run/commit, so
// you always see what happened (or would happen).
// ---------------------------------------------------------------------------

const report = {
  peopleUpserted: 0,
  placesUpserted: 0,
  exercisesUpserted: 0,
  daysProcessed: 0,
  daysWritten: 0,
  workoutsSeen: 0, // counted during transform, so this is accurate in a dry run too
  setsSeen: 0,
  workoutsWritten: 0, // only incremented by an actual Postgres write — stays 0 in a dry run
  setsWritten: 0,
  unmatchedPersonIds: new Set(),
  unmatchedPlaceIds: new Set(),
  unmatchedExerciseNames: new Set(),
  subtypesSeen: new Map(), // exercise name -> Set of subtype strings seen
  unmapped: {
    work_location: new Set(),
    commute: new Set(),
    day_type: new Set(),
  },
  categoriesFound: new Set(),
  categoriesUnmapped: new Set(),
};

// ---------------------------------------------------------------------------
// Catalog migration: people, places, exercises. Each builds a Firestore-id
// (or, for exercises, name) -> Postgres-id map used while transforming
// `days` docs below.
// ---------------------------------------------------------------------------

/** Scans every `days` doc once to find, per person, the earliest daynum they
 * were ever logged in a person1..person7/person-1..person-3 slot — used to
 * approximate "order of appearance" for migratePeople below. Always scans
 * the FULL days collection regardless of --limit/--only, since the ordering
 * should reflect real history, not whatever subset of days this particular
 * run happens to be processing. */
function computePersonFirstAppearance(daySnaps) {
  const firstAppearance = new Map();
  let earliestDaynum = Infinity;
  for (const doc of daySnaps) {
    const daynum = parseInt(doc.id, 10);
    if (!Number.isFinite(daynum)) continue;
    if (daynum < earliestDaynum) earliestDaynum = daynum;
    const data = doc.data();
    for (let i = 1; i <= 7; i++) {
      const fsId = data["person" + i];
      if (!fsId) continue;
      const cur = firstAppearance.get(fsId);
      if (cur === undefined || daynum < cur) firstAppearance.set(fsId, daynum);
    }
    for (let i = 1; i <= 3; i++) {
      const fsId = data["person-" + i];
      if (!fsId) continue;
      const cur = firstAppearance.get(fsId);
      if (cur === undefined || daynum < cur) firstAppearance.set(fsId, daynum);
    }
  }
  return { firstAppearance, earliestDaynum: Number.isFinite(earliestDaynum) ? earliestDaynum : 0 };
}

/** people.id is a plain serial, and Postgres assigns it in insertion order —
 * so the order this function inserts in *is* the order ids (and, via the
 * explicit `created_at` below, creation timestamps) end up in. Per request:
 * family members go first (tag === 'family' — they're rarely "mentioned"
 * day to day the way friends are, so sorting purely by first appearance
 * would bury them near the back, or drop them at the very end if they were
 * never logged in a day's person slots at all), then everyone else ordered
 * by their real first appearance in the diary. Within each tier, anyone
 * with no computed appearance falls back to a reasonable default instead of
 * breaking the ordering: unmentioned family default to the diary's
 * earliest day (they were presumably around from the start even if never
 * logged), unmentioned non-family default to "now" (least presumption —
 * these read as one-off catalog entries with no real signal either way). */
async function migratePeople(client, firstAppearance, earliestDaynum) {
  const snap = await fs.collection("people").get();
  const idMap = new Map();
  console.log(`people: ${snap.size} docs`);

  const entries = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const name = (d.name || "").trim();
    if (!name) continue;
    const isFamily = d.tag === "family";
    const daynum = firstAppearance.get(doc.id);
    const createdAt =
      daynum !== undefined
        ? dateFromDaynum(daynum)
        : isFamily
          ? dateFromDaynum(earliestDaynum)
          : new Date();
    entries.push({ fsId: doc.id, name, d, isFamily, daynum, createdAt });
  }

  entries.sort((a, b) => {
    if (a.isFamily !== b.isFamily) return a.isFamily ? -1 : 1;
    const aRank = a.daynum ?? Infinity;
    const bRank = b.daynum ?? Infinity;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name); // stable tiebreaker when neither ever appeared
  });

  for (const { fsId, name, d, createdAt } of entries) {
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into people (name, nicknames, birthdate, gender, tag, created_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (name) do update set
           nicknames = excluded.nicknames,
           birthdate = excluded.birthdate,
           gender = excluded.gender,
           tag = excluded.tag
         returning id`,
        [name, d.nicknames || [], d.birthdate || null, d.gender || null, d.tag || null, createdAt]
      );
      idMap.set(fsId, rows[0].id);
      report.peopleUpserted++;
    } else {
      idMap.set(fsId, -1); // placeholder id, dry run only
      report.peopleUpserted++;
    }
  }
  return idMap;
}

async function migratePlaces(client) {
  const snap = await fs.collection("places").get();
  const idMap = new Map();
  console.log(`places: ${snap.size} docs`);

  for (const doc of snap.docs) {
    const d = doc.data();
    const name = (d.name || "").trim();
    if (!name) continue;

    // Legacy places don't have a flat `address` field — it's computed at
    // creation time for a one-off geocode call, never stored. Reconstruct
    // the same way: street_num + street_name, or the place's own name for
    // a top-level Region. `category`/`subcategory` are real legacy fields;
    // combined into the single free-text `category` column here, matching
    // the deliberate "no region hierarchy" simplification already made for
    // this catalog (see the `places` table comment in schema.ts).
    const address =
      d.category === "Region"
        ? name
        : [d.street_num, d.street_name].filter(Boolean).join(" ").trim() || null;
    const category = [d.category, d.subcategory].filter(Boolean).join(" / ") || null;

    if (COMMIT) {
      const { rows } = await client.query(
        `insert into places (name, alias, address, category)
         values ($1, $2, $3, $4)
         on conflict (name) do update set
           alias = excluded.alias,
           address = excluded.address,
           category = excluded.category
         returning id`,
        [name, d.alias || null, address, category]
      );
      idMap.set(doc.id, rows[0].id);
      report.placesUpserted++;
    } else {
      idMap.set(doc.id, -1);
      report.placesUpserted++;
    }
  }
  return idMap;
}

async function migrateExercises(client) {
  const doc = await fs.collection("searchs").doc("exercises").get();
  const data = doc.data() || {};
  const idMap = new Map();
  const names = Object.keys(data);
  console.log(`exercises: ${names.length} entries in searchs/exercises`);

  for (const name of names) {
    const entry = data[name];
    const rawCategory = entry?.category;
    if (rawCategory) report.categoriesFound.add(rawCategory);
    const category = CATEGORY_MAP[rawCategory];
    if (!category) {
      report.categoriesUnmapped.add(rawCategory ?? "(none)");
      continue; // can't insert without a valid category — reported, not fatal
    }

    if (COMMIT) {
      const { rows } = await client.query(
        `insert into exercises (name, category)
         values ($1, $2)
         on conflict (name) do update set category = excluded.category
         returning id`,
        [name, category]
      );
      idMap.set(name, rows[0].id);
      report.exercisesUpserted++;
    } else {
      idMap.set(name, -1);
      report.exercisesUpserted++;
    }
  }
  return idMap;
}

// ---------------------------------------------------------------------------
// Day transform — the core of the migration. Field names on the left are
// exactly what the legacy entry/*.js files write to `days/{daynum}` (see
// the comments inline); columns on the right match src/db/schema.ts.
// ---------------------------------------------------------------------------

function transformDay(daynum, data, peopleIdMap, placesIdMap) {
  const date = parseLegacyDate(data.date, daynum);
  if (!date) return null;

  // sleep.js only ever stores sleeptime/waketime as "HH:MM" strings and
  // never stores whether the sleep-to-wake span crossed midnight — it
  // computed that transiently client-side and discarded it. Recompute the
  // same comparison it used: wake-time-of-day < sleep-time-of-day means the
  // wake happened the next calendar day.
  let wakeCrossedMidnight = false;
  if (data.sleeptime && data.waketime) {
    const s = hhmmToMinutes(data.sleeptime);
    const w = hhmmToMinutes(data.waketime);
    if (s !== null && w !== null) wakeCrossedMidnight = w < s;
  }

  const columns = {
    date,
    distance_walked_km: typeof data.distancewalked === "number" ? data.distancewalked : parseFloatOrNull(data.distancewalked),
    coffees: typeof data.coffees === "number" ? data.coffees : parseIntOrNull(data.coffees),
    sick: typeof data.sick === "boolean" ? data.sick : null,

    sleep_time: data.sleeptime || null,
    wake_time: data.waketime || null,
    wake_crossed_midnight: wakeCrossedMidnight,
    sleep_location_type: data.sleep_location?.type || null,
    sleep_location_subtype: data.sleep_location?.subtype || null,
    nap_minutes: flattenHM(data.naps),

    happiness: typeof data.happiness === "number" ? data.happiness : parseFloatOrNull(data.happiness),
    happiness_reason: data.reason || null,
    journal: data.journal || null,
    day_type: normalizeEnumValue(data.day_type, DAY_TYPES, DAY_TYPE_ALIASES, "day_type", report),

    productivity: typeof data.productivity === "number" ? data.productivity : parseFloatOrNull(data.productivity),
    work_duration_minutes: flattenHM(data.work_duration),
    work_location: normalizeEnumArray(data.work_location, WORK_LOCATIONS, WORK_LOCATION_ALIASES, "work_location", report),
    commute: normalizeEnumArray(data.commute, COMMUTES, COMMUTE_ALIASES, "commute", report),

    phone_usage_minutes: flattenHM(data.phoneusage),
    laptop_usage_minutes: flattenHM(data.laptopusage),
    instagram_usage_minutes: flattenHM(data.instausage),

    weight_kg: parseFloatOrNull(data.weight), // already kg — see WEIGHT_UNIT_IS_KG
    body_fat_percent: parseFloatOrNull(data.bodyfat),
    muscle_mass_kg: parseFloatOrNull(data.musclemass),

    instagram_followers: typeof data.insta_followers === "number" ? data.insta_followers : parseIntOrNull(data.insta_followers),
    instagram_following: typeof data.insta_following === "number" ? data.insta_following : parseIntOrNull(data.insta_following),
  };

  // Positive/negative people — legacy keys are person1..person7 (positive)
  // and person-1..person-3 (negative), values are `people` doc IDs.
  for (let i = 1; i <= 7; i++) {
    const fsId = data["person" + i];
    columns[POSITIVE_PERSON_COLUMNS[i - 1]] = resolveId(fsId, peopleIdMap, report.unmatchedPersonIds);
  }
  for (let i = 1; i <= 3; i++) {
    const fsId = data["person-" + i];
    columns[NEGATIVE_PERSON_COLUMNS[i - 1]] = resolveId(fsId, peopleIdMap, report.unmatchedPersonIds);
  }

  // Places — legacy keys are place1/place2, values are `places` doc IDs.
  columns[PLACE_COLUMNS[0]] = resolveId(data.place1, placesIdMap, report.unmatchedPlaceIds);
  columns[PLACE_COLUMNS[1]] = resolveId(data.place2, placesIdMap, report.unmatchedPlaceIds);

  // Subs — legacy stores these as flat top-level fields keyed by the
  // abbreviation itself (A, W, C, ...), straight off entry_structure/Subs's
  // `fields` array.
  SUB_NAMES.forEach((name, i) => {
    const v = data[name];
    columns[SUB_COLUMNS[i]] = typeof v === "number" ? v : parseIntOrNull(v);
  });

  return columns;
}

function resolveId(fsId, idMap, unmatchedSet) {
  if (!fsId) return null;
  const id = idMap.get(fsId);
  if (id === undefined) {
    unmatchedSet.add(fsId);
    return null;
  }
  return id;
}

function parseFloatOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function transformWorkouts(date, rawWorkouts, exerciseIdMap, placesIdMap) {
  if (!Array.isArray(rawWorkouts)) return [];
  const out = [];

  for (const w of rawWorkouts) {
    if (w.subtype) {
      const set = report.subtypesSeen.get(w.exercise) || new Set();
      set.add(w.subtype);
      report.subtypesSeen.set(w.exercise, set);
    }

    const exerciseId = exerciseIdMap.get(w.exercise);
    if (exerciseId === undefined) {
      report.unmatchedExerciseNames.add(w.exercise);
      continue; // can't insert a workout with no matching exercise
    }

    const locationId = w.location ? resolveId(w.location, placesIdMap, report.unmatchedPlaceIds) : null;
    const dataSource = String(w.data_source || "manual").toLowerCase() === "hevy" ? "hevy" : "manual";

    const sets = Array.isArray(w.sets)
      ? w.sets.map((s, i) => ({
          set_number: i + 1,
          reps: typeof s.reps === "number" ? s.reps : parseIntOrNull(s.reps),
          weight_lbs: typeof s.weight === "number" ? s.weight : parseFloatOrNull(s.weight),
          duration_seconds: flattenDurationToSeconds(s.duration),
        }))
      : [];

    out.push({
      date,
      exercise_id: exerciseId,
      location_id: locationId,
      subtype: typeof w.subtype === "string" && w.subtype.trim() ? w.subtype.trim() : null,
      data_source: dataSource,
      duration_minutes: flattenDurationToMinutes(w.exercise_duration),
      distance_km: parseFloatOrNull(w.distance), // already km — see DISTANCE_UNIT_IS_KM
      effort: typeof w.effort === "number" ? w.effort : parseIntOrNull(w.effort),
      sets,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Postgres writes
// ---------------------------------------------------------------------------

const DAY_COLUMNS = [
  "date",
  "distance_walked_km",
  "coffees",
  "sick",
  "sleep_time",
  "wake_time",
  "wake_crossed_midnight",
  "sleep_location_type",
  "sleep_location_subtype",
  "nap_minutes",
  "happiness",
  "happiness_reason",
  "journal",
  "day_type",
  "productivity",
  "work_duration_minutes",
  "work_location",
  "commute",
  "phone_usage_minutes",
  "laptop_usage_minutes",
  "instagram_usage_minutes",
  "weight_kg",
  "body_fat_percent",
  "muscle_mass_kg",
  "instagram_followers",
  "instagram_following",
  ...POSITIVE_PERSON_COLUMNS,
  ...NEGATIVE_PERSON_COLUMNS,
  ...PLACE_COLUMNS,
  ...SUB_COLUMNS,
];

async function writeDay(client, columns, workouts) {
  // NOTE: work_location/commute are Postgres enum ARRAY columns
  // (work_location_option[] / commute_option[]). node-postgres generally
  // infers the right wire format for a bound JS array from the target
  // column's type, but if you hit a "column is of type work_location_option[]
  // but expression is of type text[]" error here, the fix is to cast those
  // two placeholders explicitly in the INSERT below, e.g.
  // `$17::work_location_option[]` — not done pre-emptively since it
  // couldn't be tested against a real Postgres connection from where this
  // was written.
  const values = DAY_COLUMNS.map((c) => columns[c]);
  const placeholders = DAY_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
  const updateSet = DAY_COLUMNS.filter((c) => c !== "date")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  await client.query(
    `insert into days (${DAY_COLUMNS.join(", ")}) values (${placeholders})
     on conflict (date) do update set ${updateSet}`,
    values
  );

  // Replace-on-save for workouts/sets, same pattern the app itself uses —
  // makes this script safely re-runnable.
  await client.query(
    `delete from workout_sets where workout_id in (select id from workouts where date = $1)`,
    [columns.date]
  );
  await client.query(`delete from workouts where date = $1`, [columns.date]);

  for (let i = 0; i < workouts.length; i++) {
    const w = workouts[i];
    const { rows } = await client.query(
      `insert into workouts (date, sort_order, exercise_id, location_id, subtype, data_source, duration_minutes, distance_km, effort)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [w.date, i, w.exercise_id, w.location_id, w.subtype, w.data_source, w.duration_minutes, w.distance_km, w.effort]
    );
    const workoutId = rows[0].id;
    report.workoutsWritten++;

    for (const s of w.sets) {
      await client.query(
        `insert into workout_sets (workout_id, set_number, reps, weight_lbs, duration_seconds)
         values ($1, $2, $3, $4, $5)`,
        [workoutId, s.set_number, s.reps, s.weight_lbs, s.duration_seconds]
      );
      report.setsWritten++;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const client = await pool.connect();
  try {
    // Fetch the FULL days collection once, up front, regardless of
    // --limit/--only: person first-appearance ordering needs to reflect
    // real history, not whichever subset this run happens to process. The
    // same fetched docs are then sliced (by --only/--limit) and reused for
    // the day-processing loop below, so we never hit Firestore for `days`
    // twice.
    console.log("--- Days (fetching full collection) ---");
    const allDaySnap = await fs.collection("days").get();
    const allDaySnaps = allDaySnap.docs;
    console.log(`fetched ${allDaySnaps.length} day doc(s) total`);

    const { firstAppearance, earliestDaynum } = computePersonFirstAppearance(allDaySnaps);

    console.log("\n--- Catalogs ---");
    const peopleIdMap = await migratePeople(client, firstAppearance, earliestDaynum);
    const placesIdMap = await migratePlaces(client);
    const exerciseIdMap = await migrateExercises(client);

    if (report.categoriesUnmapped.size > 0 && COMMIT) {
      console.error(
        `\nRefusing to --commit: ${report.categoriesUnmapped.size} exercise categor${
          report.categoriesUnmapped.size === 1 ? "y is" : "ies are"
        } not in CATEGORY_MAP: ${[...report.categoriesUnmapped].join(", ")}`
      );
      console.error("Fill these into CATEGORY_MAP at the top of this script and re-run.");
      process.exit(1);
    }

    console.log("\n--- Days (processing) ---");
    let daySnaps;
    if (ONLY) {
      daySnaps = allDaySnaps.filter((doc) => doc.id === ONLY);
    } else {
      daySnaps = LIMIT ? allDaySnaps.slice(0, LIMIT) : allDaySnaps;
    }
    console.log(`processing ${daySnaps.length} day doc(s)${LIMIT ? ` (--limit=${LIMIT})` : ""}`);

    if (COMMIT) await client.query("begin");
    try {
      for (const doc of daySnaps) {
        const data = doc.data();
        report.daysProcessed++;
        const columns = transformDay(doc.id, data, peopleIdMap, placesIdMap);
        if (!columns) continue; // unparseable date, extremely unlikely — see report if daysProcessed != daysWritten

        const workouts = transformWorkouts(columns.date, data.workouts, exerciseIdMap, placesIdMap);
        report.workoutsSeen += workouts.length;
        report.setsSeen += workouts.reduce((n, w) => n + w.sets.length, 0);

        if (COMMIT) {
          await writeDay(client, columns, workouts);
        }
        report.daysWritten++;
      }
      if (COMMIT) await client.query("commit");
    } catch (err) {
      if (COMMIT) await client.query("rollback");
      throw err;
    }
  } finally {
    client.release();
  }

  printReport();
  await pool.end();
}

function printReport() {
  console.log("\n=== Report ===\n");
  console.log(`People upserted:    ${report.peopleUpserted}`);
  console.log(`Places upserted:    ${report.placesUpserted}`);
  console.log(`Exercises upserted: ${report.exercisesUpserted}`);
  console.log(`Days processed:     ${report.daysProcessed}`);
  console.log(`Days written:       ${report.daysWritten}`);
  console.log(`Workouts found:     ${report.workoutsSeen}${COMMIT ? "" : " (dry run — none written yet)"}`);
  console.log(`Sets found:         ${report.setsSeen}${COMMIT ? "" : " (dry run — none written yet)"}`);
  if (COMMIT) {
    console.log(`Workouts written:   ${report.workoutsWritten}`);
    console.log(`Sets written:       ${report.setsWritten}`);
  }

  if (report.categoriesFound.size > 0) {
    console.log(`\nExercise categories found in searchs/exercises: ${[...report.categoriesFound].join(", ")}`);
  }
  if (report.categoriesUnmapped.size > 0) {
    console.log(
      `Categories with NO entry in CATEGORY_MAP (their exercises were skipped): ${[...report.categoriesUnmapped].join(", ")}`
    );
  }

  for (const [label, set] of Object.entries(report.unmapped)) {
    if (set.size > 0) {
      console.log(`\nUnrecognized ${label} values (dropped, not fatal): ${[...set].join(", ")}`);
    }
  }

  if (report.unmatchedPersonIds.size > 0) {
    console.log(`\nPerson ids referenced by a day but not found in the people catalog: ${report.unmatchedPersonIds.size}`);
  }
  if (report.unmatchedPlaceIds.size > 0) {
    console.log(`Place ids referenced but not found in the places catalog: ${report.unmatchedPlaceIds.size}`);
  }
  if (report.unmatchedExerciseNames.size > 0) {
    console.log(`Exercise names referenced by a workout but not found/mapped: ${[...report.unmatchedExerciseNames].join(", ")}`);
  }

  if (report.subtypesSeen.size > 0) {
    console.log(
      `\nworkouts.subtype coverage — ${report.subtypesSeen.size} exercise(s) had subtype values, all captured. Sample:`
    );
    let shown = 0;
    for (const [exercise, subtypes] of report.subtypesSeen) {
      if (shown++ >= 10) {
        console.log(`  ... and ${report.subtypesSeen.size - 10} more`);
        break;
      }
      console.log(`  ${exercise}: ${[...subtypes].join(", ")}`);
    }
  }

  console.log(`\n${COMMIT ? "Wrote to Postgres." : "Dry run — nothing written. Re-run with --commit once this looks right."}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
