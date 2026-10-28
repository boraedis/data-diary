import type { InconsistencyType } from "@/db/schema";
import type { DurationDomain } from "@/lib/duration-limits";
import { FIELDS, type DaySnapshot, type FieldDef } from "@/lib/expected-fields";

/**
 * Shared shapes for the inconsistency scan (#13). Detectors are pure
 * functions from already-loaded data to `Finding[]`. Only the runner
 * (run.ts) touches the database, so every detector can be tested on
 * fixtures and new detectors (#671) plug in without changing the runner.
 */

/** What a detector reports, before it's persisted. */
export type Finding = {
  type: InconsistencyType;
  entityTable: string;
  entityId?: number | null;
  date?: string | null;
  field?: string | null;
  detail: string;
};

/**
 * The finding's identity across runs: same key, same row, so a dismissal
 * sticks. Deliberately excludes `detail`, which can change between runs
 * (a day's list of missing fields shrinks as you fill them in) without
 * becoming a different finding.
 */
export function findingKey(f: Finding): string {
  return [f.type, f.entityTable, f.entityId ?? "", f.date ?? "", f.field ?? ""].join(":");
}

/**
 * The scan's input. `snapshots` holds every date with a `days` row, with
 * satellite counts filled in. Satellite rows reference `days.date`, so a
 * date with entries always has a row, even an otherwise empty one.
 * `lastJudgedDate` is the newest date any detector may flag (see
 * `JUDGE_LAG_DAYS`).
 */
export type ScanInput = {
  snapshots: DaySnapshot[];
  lastJudgedDate: string;
  // Individual satellite rows, for the detectors that judge an entry
  // rather than a day (#671). Optional so a day-only fixture can leave
  // them out.
  entries?: EntryRow[];
  sets?: SetRow[];
};

/**
 * The satellite tables whose rows the scan judges one by one. `columns`
 * are the optional fields the referential check compares across sibling
 * rows ("nearly every movie watch has a rating, this one doesn't").
 * Fields that only apply to some rows by design are left out: a workout's
 * duration and distance depend on its exercise's category, and a TV
 * watch has no rating column at all.
 */
export const ENTRY_TABLES = {
  movie_watches: {
    label: "Movie watch",
    domain: "movies",
    columns: { rating: "rating", durationMinutes: "duration", locationType: "location" },
  },
  tv_episode_watches: {
    label: "Episode watch",
    domain: "tv",
    columns: { durationMinutes: "duration", locationType: "location" },
  },
  book_reading_sessions: {
    label: "Reading session",
    domain: "books",
    columns: { durationMinutes: "duration", locationType: "location", endPage: "end page" },
  },
  game_sessions: {
    label: "Game session",
    domain: "games",
    columns: { durationMinutes: "duration", deviceType: "device", locationType: "location" },
  },
  sports_watches: {
    label: "Sports watch",
    domain: "sports",
    columns: { durationMinutes: "duration", locationType: "location", leagueId: "league" },
  },
  entertainment_entries: {
    label: "Entertainment entry",
    domain: "entertainment",
    columns: { durationMinutes: "duration", locationType: "location" },
  },
  workouts: {
    label: "Workout",
    domain: "workouts",
    columns: { locationId: "location" },
  },
} as const satisfies Record<
  string,
  { label: string; domain: DurationDomain; columns: Record<string, string> }
>;
export type EntryTable = keyof typeof ENTRY_TABLES;

/** One satellite row: its table, id, date, and the columns above. */
export type EntryRow = {
  table: EntryTable;
  id: number;
  date: string;
  durationMinutes: number | null;
  values: Record<string, unknown>;
};

/** One workout set, with the exercise it belongs to. */
export type SetRow = {
  id: number;
  date: string;
  // Exercise name plus its free-text subtype ("Bench Press · Dumbbell"):
  // the same lift on a barbell and on dumbbells has different weights,
  // so they're judged as separate histories.
  exercise: string;
  reps: number | null;
  weightLbs: number | null;
};

/**
 * Days before today that the scan leaves alone. Logging a few days late
 * is normal (it's what /home's Days Behind counts), and a finding raised
 * against yesterday would mostly be one you were about to fix anyway. A
 * week covers the usual catch-up without hiding a real month-old gap.
 */
export const JUDGE_LAG_DAYS = 7;

export type Detector = (input: ScanInput) => Finding[];

/**
 * The registry fields the scan judges: everything except music. Listens
 * arrive in bulk Spotify imports, often months apart, so a recent
 * stretch with no music says the import is due, not that a day is
 * incomplete. That reminder already exists (#651).
 */
export const SCAN_FIELDS: readonly FieldDef[] = FIELDS.filter(
  (f) => !(f.source === "satellite" && f.domain === "music")
);
