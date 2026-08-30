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
 * run or tested against your real data. Treat every run as a dry run in
 * spirit even once `--commit` is used — read the report it prints.
 *
 * SETUP (once):
 *   npm install --save-dev firebase-admin pg
 *
 * USAGE (run from the root of this repo, data-diary):
 *   FIREBASE_SERVICE_ACCOUNT=/path/to/Data_Diary_App/data-diary-1693-firebase-adminsdk-pj4m4-857cdc78cb.json \
 *   DATABASE_URL=postgres://... \
 *   node scripts/migrate-history.mjs [--commit] [--wipe] [--limit=N] [--only=<daynum>]
 *
 * Defaults to a DRY RUN: reads every relevant Firestore collection,
 * transforms it, and prints a full coverage/warnings report — but writes
 * NOTHING to Postgres. Pass --commit to actually write.
 *
 * --wipe (2026-08-28 update) — TRUNCATEs EVERY table in this schema (not
 * just the ones this script populates — all 34, including e.g.
 * music_listens, which this script never touches) before anything else
 * runs, resetting every serial id counter back to 1. This is genuinely
 * destructive and only has any effect combined with --commit (a dry run
 * never writes, wipe included). It's a separate, more dangerous opt-in
 * from --commit on purpose: without --wipe, every write this script makes
 * is still an upsert / delete-then-reinsert keyed by a natural key, so
 * plain `--commit` re-runs stay safe the way they always were. Reach for
 * --wipe when you want a truly clean reload — e.g. after adding test data
 * by hand through the app's own UI, or after a schema change wide enough
 * that a merge isn't what you want. Combining --wipe with --limit/--only
 * prints a warning: you'd clear everything but only reload a slice of it
 * back.
 *
 * --limit=N caps how many `days` documents are processed (fastest way to
 * sanity-check the transform logic and the report before a full run).
 * --only=<daynum> processes just one specific day doc (its Firestore doc
 * ID, e.g. --only=9500) — use this together with --commit and a few
 * `console.log`s if you need to debug one specific day in isolation.
 *
 * WHAT THIS COVERS (as of the 2026-08-28 update):
 *   - Core day log: every scalar `days/{daynum}` field, workouts + sets,
 *     positive/negative people, places, subs. (unchanged from Phase 3)
 *   - People's real tag (searchs/people_extras.tags catalog + people.tagId
 *     FK, replacing the old free-text tag column).
 *   - Places' full catalog shape: category, subcategory, parentId (from
 *     the `world` collection's recursive tree), subregionName, color,
 *     metroId (from searchs/metros), lat/lng (from searchs/coordinates).
 *   - Exercise subtypes (exercise_subtypes, derived from what's actually
 *     on historical workouts, same as the original Phase 3 pass) AND
 *     exercise focus/subfocus (searchs/exercise_focuses + each exercise's
 *     .focuses array -> exercise_focuses/exercise_subfocuses/
 *     exercise_focus_links).
 *   - Entertainment, now that Phase 5 has built real per-kind catalogs:
 *       - Movies: full catalog (searchs/media, type=='movie') + one
 *         movie_watches row per day-doc movies[] entry.
 *       - TV shows: catalog only (searchs/media, type=='tv_show') — see
 *         below for what's deliberately NOT migrated here.
 *       - Sports: full sport -> league -> team catalog
 *         (entertainment/sports) + one sports_watches row per day-doc
 *         sports[] entry.
 *       - Books: full catalog (entertainment/books) + one
 *         book_reading_sessions row per day-doc books[] entry.
 *       - Games: full catalog (entertainment/games, minus its unused
 *         `series` field — no column for it) + one game_sessions row per
 *         day-doc games[] entry.
 *
 * WHAT THIS DOES NOT MIGRATE, ON PURPOSE, EVEN NOW:
 *   - TV episode-level watch history (searchs/media[id].seasons, the
 *     media_library tv_season/tv_episode docs, and each day doc's
 *     tvshows[] array). The new schema has real tv_episodes/
 *     tv_episode_watches tables, but there's no entry-form UI reading or
 *     writing them yet — building the migration for data nothing can show
 *     or edit felt premature. TV *shows* themselves are still migrated
 *     (see above) so the catalog exists once that UI lands. Revisit then.
 *   - Movie/book watchlists and rankings (entertainment/watchlists,
 *     entertainment/rankings) — same reasoning: movie_watchlist/
 *     movie_rankings/book_watchlist/book_rankings tables exist, but no UI
 *     reads/writes them yet.
 *   - Finance, todo, goals — no Postgres schema exists for these yet at
 *     all (later-phase territory), so there's nothing to migrate them
 *     into.
 *   - Music (Spotify listen history) — architecturally separate; the
 *     legacy app never persisted listens per-day in Firestore at all (it
 *     bulk-read raw Spotify export JSON at chart-render time), so there's
 *     no Firestore data for this script to read in the first place. That
 *     stays a separate in-app Spotify import flow, not migration-script
 *     territory.
 *
 * Workout `subtype` (e.g. "Barbell" vs "Dumbbell" vs "Machine" for the same
 * named exercise) IS migrated — a first dry run found it on effectively
 * every exercise in the catalog, so `workouts.subtype` was added to the
 * schema (it had been dropped, apparently by accident, during the Phase 2
 * catalog redesign) rather than silently losing that detail. See
 * `subtypesSeen` in the report below for coverage. As of this update, that
 * same set of observed subtype strings is also upserted into the real
 * `exercise_subtypes` catalog table (keyed by category, not by exercise),
 * so the entry form's subtype dropdown/autocomplete has real data to
 * offer from day one.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import admin from "firebase-admin";
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

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
// from this date. Also used to decode any other legacy field stored as a
// daynum (e.g. tv show last_refreshed/uninterested_date).
const EPOCH = new Date(2000, 3, 20); // 2000/04/20, local time

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const WIPE = args.includes("--wipe");
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
if (WIPE && !COMMIT) {
  console.log("(--wipe has no effect without --commit — a dry run never writes)\n");
}
if (WIPE && COMMIT) {
  console.log(
    "!!! --wipe --commit: about to TRUNCATE every table in this schema before reloading. !!!\n"
  );
  if (LIMIT || ONLY) {
    console.log(
      `WARNING: --wipe clears EVERYTHING, but ${
        LIMIT ? `--limit=${LIMIT}` : `--only=${ONLY}`
      } will only reload a slice of it back. You will end up with LESS data than you started with.\n`
    );
  }
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
 * first-appearance daynum, and by normalizeLegacyDateOrDaynum below. */
function dateFromDaynum(daynum) {
  const d = new Date(EPOCH);
  d.setDate(d.getDate() + daynum);
  return d;
}

/** A handful of legacy entertainment fields (tv show last_refreshed,
 * uninterested_date) were written via date2num(...) — i.e. a daynum, same
 * epoch as everything else — but some, from an older code path, may have
 * been left as a bare ISO-ish date string. Accept either; return a date
 * column string or null. */
function normalizeLegacyDateOrDaynum(v) {
  if (v === undefined || v === null || v === false || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return toDateColumn(dateFromDaynum(v));
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (/^-?\d+$/.test(trimmed)) {
      return toDateColumn(dateFromDaynum(parseInt(trimmed, 10)));
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return toDateColumn(d);
  }
  return null;
}

/** TMDB genres arrive as [{id, name}, ...]; defensively also accept a plain
 * string array in case of hand-edited data. Always returns string[]. */
function normalizeGenres(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (typeof g === "string" ? g : g && typeof g === "object" ? g.name : null))
    .filter((g) => typeof g === "string" && g.trim().length > 0);
}

/** seconds -> "1m23s" / "45s" — used by the progress bar below. */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "?";
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m${String(rem).padStart(2, "0")}s` : `${rem}s`;
}

/** Single-line, self-overwriting progress bar for the days loop below — the
 * days collection can run into the thousands, and a full --commit run does
 * several real Postgres round-trips per day, so a silent multi-minute wait
 * with no feedback was worth fixing. Redraws in place via a bare `\r` (no
 * newline) until the final call, which is what makes it "one line" rather
 * than thousands of scrolling log lines. */
function printProgress(current, total, startTime) {
  if (total <= 0) return;
  const width = 30;
  const pct = current / total;
  const filled = Math.min(width, Math.round(width * pct));
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  const elapsedSec = (Date.now() - startTime) / 1000;
  const rate = current > 0 ? current / elapsedSec : 0;
  const etaSec = rate > 0 ? (total - current) / rate : 0;
  const pctStr = String(Math.floor(pct * 100)).padStart(3, " ");
  const eta = current < total ? formatDuration(etaSec) : "0s";
  process.stdout.write(
    `\r  [${bar}] ${pctStr}%  ${current}/${total} days  —  elapsed ${formatDuration(elapsedSec)}, ETA ${eta}   `
  );
  if (current === total) process.stdout.write("\n");
}

/** hh:mm string -> minutes-since-midnight, for comparing sleep/wake times. */
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** {hours, mins|minutes} -> flat minutes. Legacy is inconsistent about the
 * minutes key name (naps/phoneusage/laptopusage/instausage use `mins`;
 * work_duration and every entertainment `duration` field use `minutes`) —
 * accept either. */
function flattenHM(obj) {
  if (!obj || typeof obj !== "object") return null;
  const hours = typeof obj.hours === "number" ? obj.hours : 0;
  const mins = typeof obj.mins === "number" ? obj.mins : typeof obj.minutes === "number" ? obj.minutes : 0;
  return hours * 60 + mins;
}

/** {hours, minutes, seconds} (any subset) -> flat minutes, rounded. Used for
 * workout exercise_duration and every entertainment duration field. */
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

// Every table in the current schema — used only by --wipe. Order doesn't
// matter (TRUNCATE ... CASCADE handles FK ordering itself), but it's listed
// in roughly the same grouping as src/db/schema.ts for easy cross-checking
// against a schema change.
const ALL_TABLES = [
  "days",
  "workouts",
  "workout_sets",
  "exercises",
  "exercise_subtypes",
  "exercise_focuses",
  "exercise_subfocuses",
  "exercise_focus_links",
  "tags",
  "place_categories",
  "place_subcategories",
  "metros",
  "people",
  "places",
  "entertainment_catalog",
  "entertainment_entries",
  "movies",
  "movie_watches",
  "movie_watchlist",
  "movie_rankings",
  "tv_shows",
  "tv_episodes",
  "tv_episode_watches",
  "books",
  "book_reading_sessions",
  "book_watchlist",
  "book_rankings",
  "sports",
  "sports_leagues",
  "sports_teams",
  "sports_watches",
  "games",
  "game_sessions",
  "music_listens",
];

async function wipeAllData(client) {
  await client.query(`truncate table ${ALL_TABLES.join(", ")} restart identity cascade`);
}

// ---------------------------------------------------------------------------
// Report accumulator — printed at the end regardless of dry-run/commit, so
// you always see what happened (or would happen).
// ---------------------------------------------------------------------------

const report = {
  tagsUpserted: 0,
  peopleUpserted: 0,
  metrosUpserted: 0,
  placesUpserted: 0,
  placesHierarchyApplied: 0,
  exerciseFocusesUpserted: 0,
  exerciseSubfocusesUpserted: 0,
  exerciseFocusLinksWritten: 0,
  exercisesUpserted: 0,
  exerciseSubtypesUpserted: 0,
  moviesUpserted: 0,
  tvShowsUpserted: 0,
  sportsUpserted: 0,
  sportsLeaguesUpserted: 0,
  sportsTeamsUpserted: 0,
  booksUpserted: 0,
  gamesUpserted: 0,

  daysProcessed: 0,
  daysWritten: 0,

  workoutsSeen: 0, // counted during transform, so this is accurate in a dry run too
  setsSeen: 0,
  workoutsWritten: 0, // only incremented by an actual Postgres write — stays 0 in a dry run
  setsWritten: 0,

  movieWatchesSeen: 0,
  movieWatchesWritten: 0,
  sportsWatchesSeen: 0,
  sportsWatchesWritten: 0,
  bookSessionsSeen: 0,
  bookSessionsWritten: 0,
  gameSessionsSeen: 0,
  gameSessionsWritten: 0,

  unmatchedPersonIds: new Set(),
  unmatchedPlaceIds: new Set(),
  unmatchedExerciseNames: new Set(),
  unmatchedTags: new Set(),
  unmatchedMetros: new Set(),
  unmatchedPlaceHierarchy: new Set(),
  unmatchedExerciseFocuses: new Set(),
  unmatchedMovies: new Set(),
  unmatchedSports: new Set(),
  unmatchedSportsLeagues: new Set(),
  unmatchedSportsTeams: new Set(),
  unmatchedBooks: new Set(),
  unmatchedGames: new Set(),

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
// Catalog migration: tags, people, metros, places (+ world hierarchy),
// exercise focuses/subfocuses, exercises. Each builds a Firestore-id (or,
// for exercises/tags/metros/sports/books/games, name) -> Postgres-id map
// used while transforming `days` docs below.
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

/** searchs/people_extras.tags = {tagName: "#hexColor"} — the real tag
 * catalog. Returns a tagName -> Postgres id map. */
async function migrateTags(client) {
  const doc = await fs.collection("searchs").doc("people_extras").get();
  const data = doc.data() || {};
  const tags = data.tags || {};
  const tagIdMap = new Map();
  const names = Object.keys(tags);
  console.log(`tags: ${names.length} entries in searchs/people_extras.tags`);

  for (const name of names) {
    const color = tags[name];
    let tagId;
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into tags (name, color)
         values ($1, $2)
         on conflict (name) do update set color = excluded.color
         returning id`,
        [name, typeof color === "string" ? color : null]
      );
      tagId = rows[0].id;
    } else {
      tagId = -1;
    }
    tagIdMap.set(name, tagId);
    report.tagsUpserted++;
  }
  return tagIdMap;
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
async function migratePeople(client, firstAppearance, earliestDaynum, tagIdMap) {
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
    let tagId = null;
    if (d.tag) {
      tagId = tagIdMap.get(d.tag) ?? null;
      if (tagId === null) report.unmatchedTags.add(d.tag);
    }

    if (COMMIT) {
      const { rows } = await client.query(
        `insert into people (name, nicknames, birthdate, gender, tag_id, created_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (name) do update set
           nicknames = excluded.nicknames,
           birthdate = excluded.birthdate,
           gender = excluded.gender,
           tag_id = excluded.tag_id
         returning id`,
        [name, d.nicknames || [], d.birthdate || null, d.gender || null, tagId, createdAt]
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

/** searchs/metros = {metroName: {name, municipalities: [placeId,...],
 * country, alias?}} — municipalities is dropped (see the metros table
 * comment in schema.ts: it's a reverse FK query now, not a stored field). */
async function migrateMetros(client) {
  const doc = await fs.collection("searchs").doc("metros").get();
  const data = doc.data() || {};
  const idMap = new Map();
  const names = Object.keys(data);
  console.log(`metros: ${names.length} entries in searchs/metros`);

  for (const name of names) {
    const d = data[name] || {};
    let metroId;
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into metros (name, country, alias)
         values ($1, $2, $3)
         on conflict (name) do update set country = excluded.country, alias = excluded.alias
         returning id`,
        [name, d.country || null, d.alias || null]
      );
      metroId = rows[0].id;
    } else {
      metroId = -1;
    }
    idMap.set(name, metroId);
    report.metrosUpserted++;
  }
  return idMap;
}

/** searchs/coordinates = {placeFsId: {lat, lng}} — a geocode cache built
 * incrementally as places were edited (functions/views/entry/database/
 * places.js's place_save). Returns the raw map as-is; callers index by
 * place fsId. */
async function fetchCoordinates() {
  const doc = await fs.collection("searchs").doc("coordinates").get();
  return doc.data() || {};
}

/** The `world` collection is a second, hand-maintained recursive index over
 * `places`: one doc per top-level country (doc ID = country name), each
 * node shaped {id (-> a `places` doc id), subregion_name, color
 * (top-level only), regions: {childName: <same recursive shape>}}.
 * Confirmed via functions/views/entry/database/world.js's
 * `getDoc(doc(db, 'places', data.regions[path[...]].id))`. Walks the whole
 * forest once and returns a flat Map of placeFsId -> parentPlaceFsId (root
 * nodes, i.e. countries with no parent of their own, are simply absent from
 * the map). */
async function fetchWorldParentMap() {
  const snap = await fs.collection("world").get();
  const parentMap = new Map();

  function walk(node, parentPlaceFsId) {
    if (!node || typeof node !== "object") return;
    const placeFsId = node.id;
    if (placeFsId) {
      if (parentPlaceFsId) parentMap.set(placeFsId, parentPlaceFsId);
      if (node.regions) {
        for (const childName of Object.keys(node.regions)) {
          walk(node.regions[childName], placeFsId);
        }
      }
    } else if (node.regions) {
      // No id of its own on this node (shouldn't normally happen) — treat
      // its children as roots rather than losing them.
      for (const childName of Object.keys(node.regions)) {
        walk(node.regions[childName], null);
      }
    }
  }

  for (const countryDoc of snap.docs) {
    walk(countryDoc.data(), null);
  }
  return parentMap;
}

/** Second pass over `places`, after both migratePlaces and
 * fetchWorldParentMap have run: applies parent_id from the world tree. Kept
 * separate from the initial insert (rather than resolving parent_id inline)
 * because a place's parent may not have been inserted yet at the point its
 * own row is created — Postgres id assignment order here follows Firestore
 * doc iteration order, not tree order. */
async function applyPlaceHierarchy(client, placesIdMap, worldParentMap) {
  for (const [childFsId, parentFsId] of worldParentMap) {
    const childId = placesIdMap.get(childFsId);
    const parentId = placesIdMap.get(parentFsId);
    if (childId === undefined) {
      report.unmatchedPlaceHierarchy.add(childFsId);
      continue;
    }
    if (parentId === undefined) {
      report.unmatchedPlaceHierarchy.add(parentFsId);
      continue;
    }
    if (COMMIT) {
      await client.query(`update places set parent_id = $1 where id = $2`, [parentId, childId]);
    }
    report.placesHierarchyApplied++;
  }
}

async function migratePlaces(client, metroIdMap, coordinates) {
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
    // a top-level Region.
    const address =
      d.category === "Region"
        ? name
        : [d.street_num, d.street_name].filter(Boolean).join(" ").trim() || null;

    let metroId = null;
    if (d.metro) {
      metroId = metroIdMap.get(d.metro) ?? null;
      if (metroId === null) report.unmatchedMetros.add(d.metro);
    }

    const coord = coordinates[doc.id];
    const lat = coord && typeof coord.lat === "number" ? coord.lat : null;
    const lng = coord && typeof coord.lng === "number" ? coord.lng : null;

    if (COMMIT) {
      const { rows } = await client.query(
        `insert into places (name, alias, address, category, subcategory, subregion_name, color, metro_id, lat, lng)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (name) do update set
           alias = excluded.alias,
           address = excluded.address,
           category = excluded.category,
           subcategory = excluded.subcategory,
           subregion_name = excluded.subregion_name,
           color = excluded.color,
           metro_id = excluded.metro_id,
           lat = excluded.lat,
           lng = excluded.lng
         returning id`,
        [
          name,
          d.alias || null,
          address,
          d.category || null,
          d.subcategory || null,
          d.subregion_name || null,
          d.color || null,
          metroId,
          lat,
          lng,
        ]
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

/** searchs/exercise_focuses = {focusName: [subfocusLabel, subfocusLabel,
 * ...]}. Each exercise's own .focuses array (see migrateExercises below)
 * references a subfocus by its ARRAY INDEX into this list, not by name —
 * subfocusIdMap is keyed "focusName/index" to mirror that. */
async function migrateExerciseFocuses(client) {
  const doc = await fs.collection("searchs").doc("exercise_focuses").get();
  const data = doc.data() || {};
  const focusIdMap = new Map();
  const subfocusIdMap = new Map();
  const focusNames = Object.keys(data);
  console.log(`exercise focuses: ${focusNames.length} entries in searchs/exercise_focuses`);

  for (const focusName of focusNames) {
    const subfocusList = Array.isArray(data[focusName]) ? data[focusName] : [];
    let focusId;
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into exercise_focuses (name)
         values ($1)
         on conflict (name) do update set name = excluded.name
         returning id`,
        [focusName]
      );
      focusId = rows[0].id;
    } else {
      focusId = -1;
    }
    focusIdMap.set(focusName, focusId);
    report.exerciseFocusesUpserted++;

    for (let i = 0; i < subfocusList.length; i++) {
      const subfocusName = subfocusList[i];
      if (!subfocusName) continue;
      let subfocusId;
      if (COMMIT) {
        const { rows } = await client.query(
          `insert into exercise_subfocuses (focus_id, name)
           values ($1, $2)
           on conflict (focus_id, name) do update set name = excluded.name
           returning id`,
          [focusId, subfocusName]
        );
        subfocusId = rows[0].id;
      } else {
        subfocusId = -1;
      }
      subfocusIdMap.set(`${focusName}/${i}`, subfocusId);
      report.exerciseSubfocusesUpserted++;
    }
  }
  return { focusIdMap, subfocusIdMap };
}

/** Returns { idMap, categoryByName } — categoryByName is needed later by
 * finalizeExerciseSubtypesFromWorkouts, which can only run after the full
 * days loop (subtypesSeen isn't complete until then). */
async function migrateExercises(client, focusIdMap, subfocusIdMap) {
  const doc = await fs.collection("searchs").doc("exercises").get();
  const data = doc.data() || {};
  const idMap = new Map();
  const categoryByName = new Map();
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
    categoryByName.set(name, category);

    let exerciseId;
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into exercises (name, category)
         values ($1, $2)
         on conflict (name) do update set category = excluded.category
         returning id`,
        [name, category]
      );
      exerciseId = rows[0].id;
    } else {
      exerciseId = -1;
    }
    idMap.set(name, exerciseId);
    report.exercisesUpserted++;

    // focus/subfocus links — delete-then-reinsert per exercise, same
    // re-runnable pattern as workouts/sets.
    if (COMMIT) {
      await client.query(`delete from exercise_focus_links where exercise_id = $1`, [exerciseId]);
    }
    const focuses = Array.isArray(entry?.focuses) ? entry.focuses : [];
    for (const f of focuses) {
      const focusId = focusIdMap.get(f.focus);
      if (focusId === undefined) {
        report.unmatchedExerciseFocuses.add(f.focus);
        continue;
      }
      let subfocusId = null;
      if (f.subfocus !== undefined && f.subfocus !== null) {
        const key = `${f.focus}/${f.subfocus}`;
        const resolved = subfocusIdMap.get(key);
        if (resolved === undefined) {
          report.unmatchedExerciseFocuses.add(key);
        } else {
          subfocusId = resolved;
        }
      }
      if (COMMIT) {
        await client.query(
          `insert into exercise_focus_links (exercise_id, focus_id, subfocus_id, label)
           values ($1, $2, $3, $4)`,
          [exerciseId, focusId, subfocusId, f.label || null]
        );
      }
      report.exerciseFocusLinksWritten++;
    }
  }
  return { idMap, categoryByName };
}

/** Must run AFTER the days loop — report.subtypesSeen isn't complete until
 * every workout has been transformed. Upserts the distinct
 * (category, subtypeName) pairs actually observed into the real
 * exercise_subtypes catalog table. */
async function finalizeExerciseSubtypesFromWorkouts(client, categoryByName) {
  const byCategory = new Map(); // category -> Set(subtypeName)
  for (const [exerciseName, subtypes] of report.subtypesSeen) {
    const category = categoryByName.get(exerciseName);
    if (!category) continue; // exercise itself was skipped (unmapped category)
    const set = byCategory.get(category) || new Set();
    for (const subtype of subtypes) set.add(subtype);
    byCategory.set(category, set);
  }
  for (const [category, names] of byCategory) {
    for (const name of names) {
      if (COMMIT) {
        await client.query(
          `insert into exercise_subtypes (category, name)
           values ($1, $2)
           on conflict (category, name) do nothing`,
          [category, name]
        );
      }
      report.exerciseSubtypesUpserted++;
    }
  }
}

// ---------------------------------------------------------------------------
// Entertainment catalog migration: movies/TV, sports, books, games. Each
// builds a Firestore-key -> Postgres-id map (or, for sports, several,
// composite-keyed) used while transforming `days` docs below.
// ---------------------------------------------------------------------------

/** searchs/media = {mediaFsId: {name, release_date, type: 'movie'|
 * 'tv_show', runtime, watches: {date: count} (legacy denormalized index,
 * NOT migrated — day docs' own movies[] arrays are the source of truth for
 * movie_watches below), id, tmdb_id, genres: [{id,name}], poster_path,
 * collection?, seasons?, interested?, uninterested_date?, status?,
 * last_refreshed?, next_episode?}}. Returns a movieFsId -> Postgres movie
 * id map (TV shows don't need one — nothing downstream references a TV
 * show by id, since episode watches aren't migrated). */
async function migrateMoviesAndTvShows(client) {
  const doc = await fs.collection("searchs").doc("media").get();
  const data = doc.data() || {};
  const movieIdMapByFsId = new Map();
  const fsIds = Object.keys(data);
  console.log(`movies/TV: ${fsIds.length} entries in searchs/media`);

  for (const fsId of fsIds) {
    const d = data[fsId];
    if (!d || !d.tmdb_id) continue;

    if (d.type === "movie") {
      const runtime = typeof d.runtime === "number" ? d.runtime : parseIntOrNull(d.runtime);
      if (COMMIT) {
        const { rows } = await client.query(
          `insert into movies (tmdb_id, title, release_date, runtime_minutes, poster_path, genres, collection_name)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (tmdb_id) do update set
             title = excluded.title,
             release_date = excluded.release_date,
             runtime_minutes = excluded.runtime_minutes,
             poster_path = excluded.poster_path,
             genres = excluded.genres,
             collection_name = excluded.collection_name
           returning id`,
          [d.tmdb_id, d.name || "(untitled)", d.release_date || null, runtime || null, d.poster_path || null, normalizeGenres(d.genres), d.collection || null]
        );
        movieIdMapByFsId.set(fsId, rows[0].id);
      } else {
        movieIdMapByFsId.set(fsId, -1);
      }
      report.moviesUpserted++;
    } else if (d.type === "tv_show") {
      // next_episode started life (tv.show.post) as a raw ISO date string
      // or `false`, and gets overwritten (tv.refresh_show) with a real
      // {date (daynum), season, episode} object once refreshed at least
      // once — accept whichever shape is actually on the doc.
      let nextEpisodeDate = null;
      let nextEpisodeSeason = null;
      let nextEpisodeNumber = null;
      const rawNext = d.next_episode;
      if (rawNext && rawNext !== false) {
        if (typeof rawNext === "object") {
          nextEpisodeDate = normalizeLegacyDateOrDaynum(rawNext.date);
          nextEpisodeSeason = parseIntOrNull(rawNext.season);
          nextEpisodeNumber = parseIntOrNull(rawNext.episode);
        } else if (typeof rawNext === "string") {
          const dt = new Date(rawNext);
          if (!Number.isNaN(dt.getTime())) nextEpisodeDate = toDateColumn(dt);
        }
      }

      if (COMMIT) {
        await client.query(
          `insert into tv_shows (tmdb_id, title, poster_path, genres, status, interested, uninterested_date, last_refreshed, next_episode_date, next_episode_season, next_episode_number)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (tmdb_id) do update set
             title = excluded.title,
             poster_path = excluded.poster_path,
             genres = excluded.genres,
             status = excluded.status,
             interested = excluded.interested,
             uninterested_date = excluded.uninterested_date,
             last_refreshed = excluded.last_refreshed,
             next_episode_date = excluded.next_episode_date,
             next_episode_season = excluded.next_episode_season,
             next_episode_number = excluded.next_episode_number`,
          [
            d.tmdb_id,
            d.name || "(untitled)",
            d.poster_path || null,
            normalizeGenres(d.genres),
            d.status || null,
            d.interested !== false,
            normalizeLegacyDateOrDaynum(d.uninterested_date),
            normalizeLegacyDateOrDaynum(d.last_refreshed),
            nextEpisodeDate,
            nextEpisodeSeason,
            nextEpisodeNumber,
          ]
        );
      }
      report.tvShowsUpserted++;
    }
  }
  return movieIdMapByFsId;
}

/** entertainment/sports = {sportName: {is_team_sport, leagues:
 * {leagueName: {type, seasons: [], divisions: []}}, teams: {teamName:
 * {name, alias, city (or, for individual-athlete sports, a genuine typo
 * "nationaltity" — see sports_teams.homeLocation's comment in schema.ts),
 * sport, league, color, division?}}}. Seasons/divisions stay free text on
 * the log/team (see sports_watches.season / sports_teams.division) — in
 * the legacy app they're just label lists scoped to a league, not real
 * entities with attributes of their own. */
async function migrateSportsCatalog(client) {
  const doc = await fs.collection("entertainment").doc("sports").get();
  const data = doc.data() || {};
  const sportIdMap = new Map();
  const leagueIdMap = new Map(); // "sportName/leagueName" -> id
  const teamIdMap = new Map(); // "sportName/teamName" -> id
  const sportNames = Object.keys(data);
  console.log(`sports: ${sportNames.length} entries in entertainment/sports`);

  for (const sportName of sportNames) {
    const sport = data[sportName] || {};
    let sportId;
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into sports (name, is_team_sport)
         values ($1, $2)
         on conflict (name) do update set is_team_sport = excluded.is_team_sport
         returning id`,
        [sportName, sport.is_team_sport !== false]
      );
      sportId = rows[0].id;
    } else {
      sportId = -1;
    }
    sportIdMap.set(sportName, sportId);
    report.sportsUpserted++;

    for (const leagueName of Object.keys(sport.leagues || {})) {
      const league = sport.leagues[leagueName] || {};
      let leagueId;
      if (COMMIT) {
        const { rows } = await client.query(
          `insert into sports_leagues (sport_id, name, type)
           values ($1, $2, $3)
           on conflict (sport_id, name) do update set type = excluded.type
           returning id`,
          [sportId, leagueName, league.type || null]
        );
        leagueId = rows[0].id;
      } else {
        leagueId = -1;
      }
      leagueIdMap.set(`${sportName}/${leagueName}`, leagueId);
      report.sportsLeaguesUpserted++;
    }

    for (const teamName of Object.keys(sport.teams || {})) {
      const team = sport.teams[teamName] || {};
      let leagueId = null;
      if (team.league) {
        leagueId = leagueIdMap.get(`${sportName}/${team.league}`) ?? null;
        if (leagueId === null) report.unmatchedSportsLeagues.add(`${sportName}/${team.league}`);
      }
      const homeLocation = team.city || team.nationaltity || null;

      if (COMMIT) {
        const { rows } = await client.query(
          `insert into sports_teams (sport_id, league_id, name, alias, home_location, color, division)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (sport_id, name) do update set
             league_id = excluded.league_id,
             alias = excluded.alias,
             home_location = excluded.home_location,
             color = excluded.color,
             division = excluded.division
           returning id`,
          [sportId, leagueId, teamName, team.alias || null, homeLocation, team.color || null, team.division || null]
        );
        teamIdMap.set(`${sportName}/${teamName}`, rows[0].id);
      } else {
        teamIdMap.set(`${sportName}/${teamName}`, -1);
      }
      report.sportsTeamsUpserted++;
    }
  }
  return { sportIdMap, leagueIdMap, teamIdMap };
}

/** entertainment/books = {googleBooksId: {title, authors, publisher,
 * publishedDate, description, pageCount, categories, thumbnail (or
 * imageLinks.thumbnail — best-effort, this script accepts either field
 * name since the exact shape wasn't independently confirmed), bookmark,
 * completions, id}}. bookmark/completions are deliberately NOT migrated —
 * per the books table comment in schema.ts, both are trivially computed on
 * read instead of kept in sync by hand. */
async function migrateBooksCatalog(client) {
  const doc = await fs.collection("entertainment").doc("books").get();
  const data = doc.data() || {};
  const idMap = new Map();
  const googleBooksIds = Object.keys(data);
  console.log(`books: ${googleBooksIds.length} entries in entertainment/books`);

  for (const googleBooksId of googleBooksIds) {
    const d = data[googleBooksId] || {};
    const thumbnailUrl = d.thumbnail || d.thumbnailUrl || d.imageLinks?.thumbnail || d.imageLinks?.smallThumbnail || null;

    if (COMMIT) {
      const { rows } = await client.query(
        `insert into books (google_books_id, title, authors, publisher, published_date, description, thumbnail_url, page_count, categories)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (google_books_id) do update set
           title = excluded.title,
           authors = excluded.authors,
           publisher = excluded.publisher,
           published_date = excluded.published_date,
           description = excluded.description,
           thumbnail_url = excluded.thumbnail_url,
           page_count = excluded.page_count,
           categories = excluded.categories
         returning id`,
        [
          googleBooksId,
          d.title || "(untitled)",
          Array.isArray(d.authors) ? d.authors : [],
          d.publisher || null,
          d.publishedDate || null,
          d.description || null,
          thumbnailUrl,
          typeof d.pageCount === "number" ? d.pageCount : parseIntOrNull(d.pageCount),
          Array.isArray(d.categories) ? d.categories : [],
        ]
      );
      idMap.set(googleBooksId, rows[0].id);
    } else {
      idMap.set(googleBooksId, -1);
    }
    report.booksUpserted++;
  }
  return idMap;
}

/** entertainment/games = {gameName: {name, type, subtype, series?}} —
 * `series` is dropped, no column for it (see the games table comment in
 * schema.ts: this domain is kept intentionally minimal). */
async function migrateGamesCatalog(client) {
  const doc = await fs.collection("entertainment").doc("games").get();
  const data = doc.data() || {};
  const idMap = new Map();
  const gameNames = Object.keys(data);
  console.log(`games: ${gameNames.length} entries in entertainment/games`);

  for (const gameName of gameNames) {
    const d = data[gameName] || {};
    if (COMMIT) {
      const { rows } = await client.query(
        `insert into games (name, type, subtype)
         values ($1, $2, $3)
         on conflict (name) do update set type = excluded.type, subtype = excluded.subtype
         returning id`,
        [gameName, d.type || null, d.subtype || null]
      );
      idMap.set(gameName, rows[0].id);
    } else {
      idMap.set(gameName, -1);
    }
    report.gamesUpserted++;
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

/** Day doc movies[]: {id (=media fsId), name, type:'movie', rating,
 * location_type}. Source of truth for movie_watches — NOT the legacy
 * searchs/media[id].watches map, which was just a hand-maintained
 * denormalized count kept in sync at add-time. */
function transformMovieWatches(date, rawMovies, movieIdMapByFsId) {
  if (!Array.isArray(rawMovies)) return [];
  const out = [];
  for (const m of rawMovies) {
    const movieId = movieIdMapByFsId.get(m.id);
    if (movieId === undefined) {
      report.unmatchedMovies.add(m.id || m.name || "(unknown)");
      continue;
    }
    out.push({
      date,
      movie_id: movieId,
      rating: typeof m.rating === "number" ? m.rating : parseIntOrNull(m.rating),
      location_type: m.location_type || null,
    });
  }
  return out;
}

/** Day doc sports[]: {sport, league, season, game_type, location_type,
 * watched_live, duration: {hours, minutes, seconds}, home_team?,
 * away_team?}. home_team/away_team are stored by TEAM NAME (see
 * entertainment.js's addSport: `readField(..., {source_display: 'name'})`),
 * not id — resolved here via the composite "sport/team" key. */
function transformSportsWatches(date, rawSports, sportIdMap, leagueIdMap, teamIdMap) {
  if (!Array.isArray(rawSports)) return [];
  const out = [];
  for (const s of rawSports) {
    const sportId = sportIdMap.get(s.sport);
    if (sportId === undefined) {
      report.unmatchedSports.add(s.sport);
      continue;
    }
    let leagueId = null;
    if (s.league) {
      leagueId = leagueIdMap.get(`${s.sport}/${s.league}`) ?? null;
      if (leagueId === null) report.unmatchedSportsLeagues.add(`${s.sport}/${s.league}`);
    }
    let homeTeamId = null;
    if (s.home_team) {
      homeTeamId = teamIdMap.get(`${s.sport}/${s.home_team}`) ?? null;
      if (homeTeamId === null) report.unmatchedSportsTeams.add(`${s.sport}/${s.home_team}`);
    }
    let awayTeamId = null;
    if (s.away_team) {
      awayTeamId = teamIdMap.get(`${s.sport}/${s.away_team}`) ?? null;
      if (awayTeamId === null) report.unmatchedSportsTeams.add(`${s.sport}/${s.away_team}`);
    }
    out.push({
      date,
      sport_id: sportId,
      league_id: leagueId,
      season: s.season || null,
      game_type: s.game_type || null,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      watched_live: !!s.watched_live,
      duration_minutes: flattenDurationToMinutes(s.duration),
      location_type: s.location_type || null,
    });
  }
  return out;
}

/** Day doc books[]: {book (=googleBooksId), title, name, start_page,
 * end_page, completed: 'true'|'false' (a legacy radio field — a STRING,
 * not a boolean), location_type, duration: {hours, minutes}}. */
function transformBookSessions(date, rawBooks, bookIdMap) {
  if (!Array.isArray(rawBooks)) return [];
  const out = [];
  for (const b of rawBooks) {
    const bookId = bookIdMap.get(b.book);
    if (bookId === undefined) {
      report.unmatchedBooks.add(b.book || b.title || "(unknown)");
      continue;
    }
    out.push({
      date,
      book_id: bookId,
      start_page: typeof b.start_page === "number" ? b.start_page : parseIntOrNull(b.start_page),
      end_page: typeof b.end_page === "number" ? b.end_page : parseIntOrNull(b.end_page),
      completed: b.completed === true || b.completed === "true",
      location_type: b.location_type || null,
      duration_minutes: flattenDurationToMinutes(b.duration),
    });
  }
  return out;
}

/** Day doc games[]: {game (=game name), duration: {hours, minutes},
 * location_type, device?}. */
function transformGameSessions(date, rawGames, gameIdMap) {
  if (!Array.isArray(rawGames)) return [];
  const out = [];
  for (const g of rawGames) {
    const gameId = gameIdMap.get(g.game);
    if (gameId === undefined) {
      report.unmatchedGames.add(g.game || "(unknown)");
      continue;
    }
    out.push({
      date,
      game_id: gameId,
      duration_minutes: flattenDurationToMinutes(g.duration),
      device: g.device || null,
      location_type: g.location_type || null,
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

async function writeMovieWatches(client, date, watches) {
  await client.query(`delete from movie_watches where date = $1`, [date]);
  for (const w of watches) {
    await client.query(
      `insert into movie_watches (movie_id, date, rating, location_type) values ($1, $2, $3, $4)`,
      [w.movie_id, w.date, w.rating, w.location_type]
    );
    report.movieWatchesWritten++;
  }
}

async function writeSportsWatches(client, date, watches) {
  await client.query(`delete from sports_watches where date = $1`, [date]);
  for (const w of watches) {
    await client.query(
      `insert into sports_watches (sport_id, league_id, season, game_type, home_team_id, away_team_id, date, watched_live, duration_minutes, location_type)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [w.sport_id, w.league_id, w.season, w.game_type, w.home_team_id, w.away_team_id, w.date, w.watched_live, w.duration_minutes, w.location_type]
    );
    report.sportsWatchesWritten++;
  }
}

async function writeBookSessions(client, date, sessions) {
  await client.query(`delete from book_reading_sessions where date = $1`, [date]);
  for (const s of sessions) {
    await client.query(
      `insert into book_reading_sessions (book_id, date, start_page, end_page, completed, location_type, duration_minutes)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [s.book_id, s.date, s.start_page, s.end_page, s.completed, s.location_type, s.duration_minutes]
    );
    report.bookSessionsWritten++;
  }
}

async function writeGameSessions(client, date, sessions) {
  await client.query(`delete from game_sessions where date = $1`, [date]);
  for (const s of sessions) {
    await client.query(
      `insert into game_sessions (game_id, date, duration_minutes, device, location_type)
       values ($1, $2, $3, $4, $5)`,
      [s.game_id, s.date, s.duration_minutes, s.device, s.location_type]
    );
    report.gameSessionsWritten++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Dry runs are safe against any database, so only gate the run that can
  // actually write — see scripts/lib/prod-guard.mjs for why this exists.
  if (COMMIT) await guardAgainstProd({ scriptName: "migrate-history.mjs --commit" });

  const client = await pool.connect();
  try {
    if (COMMIT && WIPE) {
      console.log("--- Wiping existing data (--wipe) ---");
      await wipeAllData(client);
      console.log(`Truncated ${ALL_TABLES.length} tables and reset all id sequences.\n`);
    }

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
    const tagIdMap = await migrateTags(client);
    const peopleIdMap = await migratePeople(client, firstAppearance, earliestDaynum, tagIdMap);
    const metroIdMap = await migrateMetros(client);
    const coordinates = await fetchCoordinates();
    const placesIdMap = await migratePlaces(client, metroIdMap, coordinates);
    const worldParentMap = await fetchWorldParentMap();
    await applyPlaceHierarchy(client, placesIdMap, worldParentMap);
    const { focusIdMap, subfocusIdMap } = await migrateExerciseFocuses(client);
    const { idMap: exerciseIdMap, categoryByName: exerciseCategoryByName } = await migrateExercises(
      client,
      focusIdMap,
      subfocusIdMap
    );

    if (report.categoriesUnmapped.size > 0 && COMMIT) {
      console.error(
        `\nRefusing to --commit: ${report.categoriesUnmapped.size} exercise categor${
          report.categoriesUnmapped.size === 1 ? "y is" : "ies are"
        } not in CATEGORY_MAP: ${[...report.categoriesUnmapped].join(", ")}`
      );
      console.error("Fill these into CATEGORY_MAP at the top of this script and re-run.");
      process.exit(1);
    }

    console.log("\n--- Entertainment catalogs ---");
    const movieIdMapByFsId = await migrateMoviesAndTvShows(client);
    const { sportIdMap, leagueIdMap, teamIdMap } = await migrateSportsCatalog(client);
    const bookIdMap = await migrateBooksCatalog(client);
    const gameIdMap = await migrateGamesCatalog(client);

    console.log("\n--- Days (processing) ---");
    let daySnaps;
    if (ONLY) {
      daySnaps = allDaySnaps.filter((doc) => doc.id === ONLY);
    } else {
      daySnaps = LIMIT ? allDaySnaps.slice(0, LIMIT) : allDaySnaps;
    }
    console.log(`processing ${daySnaps.length} day doc(s)${LIMIT ? ` (--limit=${LIMIT})` : ""}`);

    // Redraw the progress bar at most ~200 times over the whole run (always
    // including the very first and last day) rather than on every single
    // iteration — plenty smooth to watch, without spending time on terminal
    // I/O for collections in the thousands.
    const progressEvery = Math.max(1, Math.floor(daySnaps.length / 200));
    const loopStartTime = Date.now();

    if (COMMIT) await client.query("begin");
    try {
      for (let i = 0; i < daySnaps.length; i++) {
        const doc = daySnaps[i];
        const data = doc.data();
        report.daysProcessed++;

        const columns = transformDay(doc.id, data, peopleIdMap, placesIdMap);
        if (columns) {
          // unparseable date (columns === null) is extremely unlikely — see
          // the report afterward if daysProcessed != daysWritten
          const workouts = transformWorkouts(columns.date, data.workouts, exerciseIdMap, placesIdMap);
          report.workoutsSeen += workouts.length;
          report.setsSeen += workouts.reduce((n, w) => n + w.sets.length, 0);

          const movieWatches = transformMovieWatches(columns.date, data.movies, movieIdMapByFsId);
          report.movieWatchesSeen += movieWatches.length;

          const sportsWatches = transformSportsWatches(columns.date, data.sports, sportIdMap, leagueIdMap, teamIdMap);
          report.sportsWatchesSeen += sportsWatches.length;

          const bookSessions = transformBookSessions(columns.date, data.books, bookIdMap);
          report.bookSessionsSeen += bookSessions.length;

          const gameSessions = transformGameSessions(columns.date, data.games, gameIdMap);
          report.gameSessionsSeen += gameSessions.length;

          if (COMMIT) {
            await writeDay(client, columns, workouts);
            await writeMovieWatches(client, columns.date, movieWatches);
            await writeSportsWatches(client, columns.date, sportsWatches);
            await writeBookSessions(client, columns.date, bookSessions);
            await writeGameSessions(client, columns.date, gameSessions);
          }
          report.daysWritten++;
        }

        if ((i + 1) % progressEvery === 0 || i + 1 === daySnaps.length) {
          printProgress(i + 1, daySnaps.length, loopStartTime);
        }
      }

      // Needs the now-complete report.subtypesSeen from the loop above.
      await finalizeExerciseSubtypesFromWorkouts(client, exerciseCategoryByName);

      if (COMMIT) await client.query("commit");
    } catch (err) {
      process.stdout.write("\n"); // don't let the error print get glued onto the progress bar's line
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
  const note = COMMIT ? "" : " (dry run — none written yet)";

  console.log("\n=== Report ===\n");

  console.log("-- Core catalogs --");
  console.log(`Tags upserted:            ${report.tagsUpserted}`);
  console.log(`People upserted:          ${report.peopleUpserted}`);
  console.log(`Metros upserted:          ${report.metrosUpserted}`);
  console.log(`Places upserted:          ${report.placesUpserted}`);
  console.log(`Place hierarchy applied:  ${report.placesHierarchyApplied}`);
  console.log(`Exercise focuses:         ${report.exerciseFocusesUpserted}`);
  console.log(`Exercise subfocuses:      ${report.exerciseSubfocusesUpserted}`);
  console.log(`Exercise focus links:     ${report.exerciseFocusLinksWritten}`);
  console.log(`Exercises upserted:       ${report.exercisesUpserted}`);
  console.log(`Exercise subtypes:        ${report.exerciseSubtypesUpserted}`);

  console.log("\n-- Entertainment catalogs --");
  console.log(`Movies upserted:          ${report.moviesUpserted}`);
  console.log(`TV shows upserted:        ${report.tvShowsUpserted}`);
  console.log(`Sports upserted:          ${report.sportsUpserted}`);
  console.log(`Sports leagues upserted:  ${report.sportsLeaguesUpserted}`);
  console.log(`Sports teams upserted:    ${report.sportsTeamsUpserted}`);
  console.log(`Books upserted:           ${report.booksUpserted}`);
  console.log(`Games upserted:           ${report.gamesUpserted}`);

  console.log("\n-- Days --");
  console.log(`Days processed:           ${report.daysProcessed}`);
  console.log(`Days written:             ${report.daysWritten}`);
  console.log(`Workouts found:           ${report.workoutsSeen}${note}`);
  console.log(`Sets found:               ${report.setsSeen}${note}`);
  console.log(`Movie watches found:      ${report.movieWatchesSeen}${note}`);
  console.log(`Sports watches found:     ${report.sportsWatchesSeen}${note}`);
  console.log(`Book sessions found:      ${report.bookSessionsSeen}${note}`);
  console.log(`Game sessions found:      ${report.gameSessionsSeen}${note}`);
  if (COMMIT) {
    console.log(`Workouts written:         ${report.workoutsWritten}`);
    console.log(`Sets written:             ${report.setsWritten}`);
    console.log(`Movie watches written:    ${report.movieWatchesWritten}`);
    console.log(`Sports watches written:   ${report.sportsWatchesWritten}`);
    console.log(`Book sessions written:    ${report.bookSessionsWritten}`);
    console.log(`Game sessions written:    ${report.gameSessionsWritten}`);
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

  const unmatchedSections = [
    ["Person ids referenced by a day but not found in the people catalog", report.unmatchedPersonIds],
    ["Place ids referenced but not found in the places catalog", report.unmatchedPlaceIds],
    ["Exercise names referenced by a workout but not found/mapped", report.unmatchedExerciseNames],
    ["Person tag names not found in the tags catalog", report.unmatchedTags],
    ["Place metro names not found in the metros catalog", report.unmatchedMetros],
    ["world-tree place ids not found in the places catalog (hierarchy skipped)", report.unmatchedPlaceHierarchy],
    ["Exercise focus/subfocus references not found in the focuses catalog", report.unmatchedExerciseFocuses],
    ["Movie ids referenced by a day but not found in the media catalog", report.unmatchedMovies],
    ["Sports referenced by a day but not found in the sports catalog", report.unmatchedSports],
    ["Sports leagues referenced but not found", report.unmatchedSportsLeagues],
    ["Sports teams referenced but not found", report.unmatchedSportsTeams],
    ["Books referenced by a day but not found in the books catalog", report.unmatchedBooks],
    ["Games referenced by a day but not found in the games catalog", report.unmatchedGames],
  ];
  for (const [label, set] of unmatchedSections) {
    if (set.size > 0) {
      console.log(`\n${label}: ${set.size} — ${[...set].slice(0, 20).join(", ")}${set.size > 20 ? ", ..." : ""}`);
    }
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
