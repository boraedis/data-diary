import type { InconsistencyType } from "@/db/schema";
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
