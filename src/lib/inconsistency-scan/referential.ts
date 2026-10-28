import { ENTRY_TABLES, type EntryRow, type EntryTable, type Finding, type ScanInput, type SetRow } from "./types";

/**
 * Type 4 findings, "referential oddity" (#13): an entry that doesn't fit
 * the entries around it. A movie watch with no rating when nearly every
 * other one has one, or a workout set far heavier than anything you've
 * lifted on that exercise.
 */

export type MissingEntryFieldOptions = {
  /** Earlier rows of the same table the fill rate is taken over. */
  window?: number;
  /** Fewer earlier rows than this, and the row isn't judged. */
  minRows?: number;
  /** Fill rate above which an empty value is flagged. */
  cutoff?: number;
};

export const MISSING_ENTRY_FIELD_DEFAULTS = { window: 50, minRows: 20, cutoff: 0.95 } as const;

function isSet(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function byDateThenId<T extends { date: string; id: number }>(a: T, b: T): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
}

/**
 * Per satellite table and checked column (ENTRY_TABLES), a row missing a
 * value that the `window` rows before it almost all have. Trailing rather
 * than all-time for the same reason the day registry is: a field you
 * started filling in 2022 isn't missing from a 2018 row.
 *
 * Stricter than the day fields' cutoff (0.95 against 0.9): these are
 * per-entry details you fill in the moment you log the entry, so a gap
 * among near-total coverage is much more likely a slip.
 *
 * Flags nothing on production as of #671. Every checked column is
 * either fully filled (durations, locations, leagues) or far below any
 * cutoff (movie ratings 56%, game devices 17%), and results were the
 * same at 0.9, 0.95 and 0.98. It's here for the first slip, not for a
 * backlog.
 */
export function detectMissingEntryFields(
  input: ScanInput,
  options: MissingEntryFieldOptions = {}
): Finding[] {
  const {
    window = MISSING_ENTRY_FIELD_DEFAULTS.window,
    minRows = MISSING_ENTRY_FIELD_DEFAULTS.minRows,
    cutoff = MISSING_ENTRY_FIELD_DEFAULTS.cutoff,
  } = options;

  const byTable = new Map<EntryTable, EntryRow[]>();
  for (const e of input.entries ?? []) {
    const rows = byTable.get(e.table) ?? [];
    rows.push(e);
    byTable.set(e.table, rows);
  }

  const findings: Finding[] = [];
  for (const [table, rows] of byTable) {
    rows.sort(byDateThenId);
    const { label, columns } = ENTRY_TABLES[table];
    for (const [column, name] of Object.entries(columns) as [string, string][]) {
      const valueOf = (r: EntryRow) =>
        column === "durationMinutes" ? r.durationMinutes : r.values[column];
      let filledInWindow = 0;
      rows.forEach((row, i) => {
        if (i > window && isSet(valueOf(rows[i - window - 1]))) filledInWindow--;
        if (i > 0 && isSet(valueOf(rows[i - 1]))) filledInWindow++;
        const seen = Math.min(i, window);
        if (row.date > input.lastJudgedDate || seen < minRows || isSet(valueOf(row))) return;
        const rate = filledInWindow / seen;
        if (rate <= cutoff) return;
        findings.push({
          type: "referential",
          entityTable: table,
          entityId: row.id,
          date: row.date,
          field: column,
          detail: `${label} has no ${name}, unlike ${Math.round(rate * 100)}% of the ${seen} before it`,
        });
      });
    }
  }
  return findings;
}

export type WorkoutJumpOptions = {
  /** Earlier (and later) sets of the same exercise compared with. */
  history?: number;
  /** Fewer earlier sets than this, and a set isn't judged. */
  minHistory?: number;
  /** A set heavier than this multiple of the earlier sets' max is flagged… */
  weightFactor?: number;
  /** …if it's also at least this many pounds over it. */
  minWeightJumpLbs?: number;
  repsFactor?: number;
  minRepsJump?: number;
};

export const WORKOUT_JUMP_DEFAULTS = {
  history: 30,
  minHistory: 10,
  weightFactor: 1.6,
  minWeightJumpLbs: 20,
  repsFactor: 2.5,
  minRepsJump: 10,
} as const;

/**
 * A workout set whose weight or reps jumps far past every recent set of
 * the same exercise (name and subtype, see SetRow). The usual shape is a
 * stray digit, like 1350 for 135. Compared with the *max* of earlier sets
 * rather than their average, because a session's warm-up sets would drag
 * an average down and make every working set look like a jump.
 *
 * Two-sided, like the rolling outlier check: when later sets reach the
 * same level, it's a real step up (a new program, a different setup)
 * rather than a typo, and isn't flagged.
 *
 * On production's 3,702 sets across 74 exercise/subtype pairs (#671),
 * 1.4x and 1.6x each flagged the same single set and 2x flagged none.
 * 1.6x keeps that one without leaning on the looser setting.
 */
export function detectWorkoutJumps(input: ScanInput, options: WorkoutJumpOptions = {}): Finding[] {
  const o = { ...WORKOUT_JUMP_DEFAULTS, ...options };
  const byExercise = new Map<string, SetRow[]>();
  for (const s of input.sets ?? []) {
    const rows = byExercise.get(s.exercise) ?? [];
    rows.push(s);
    byExercise.set(s.exercise, rows);
  }

  const findings: Finding[] = [];
  const check = (
    rows: SetRow[],
    i: number,
    pick: (s: SetRow) => number | null,
    factor: number,
    minJump: number,
    describe: (value: number, max: number) => string
  ) => {
    const value = pick(rows[i]);
    if (value === null || value <= 0) return false;
    const earlier = rows.slice(Math.max(0, i - o.history), i).map(pick).filter((v): v is number => v !== null && v > 0);
    if (earlier.length < o.minHistory) return false;
    const max = Math.max(...earlier);
    if (value <= max * factor || value - max < minJump) return false;
    const later = rows.slice(i + 1, i + 1 + o.history).map(pick).filter((v): v is number => v !== null);
    if (later.some((v) => v >= value * 0.9)) return false;
    findings.push({
      type: "referential",
      entityTable: "workout_sets",
      entityId: rows[i].id,
      date: rows[i].date,
      field: pick === weightOf ? "weightLbs" : "reps",
      detail: describe(value, max),
    });
    return true;
  };

  for (const [exercise, rows] of byExercise) {
    rows.sort(byDateThenId);
    rows.forEach((s, i) => {
      if (s.date > input.lastJudgedDate) return;
      const weightFlagged = check(rows, i, weightOf, o.weightFactor, o.minWeightJumpLbs, (v, max) =>
        `${exercise} set at ${v} lb, against a heaviest of ${max} lb in the ${o.history} sets before it`
      );
      // One finding per set: a set with a wild weight usually has normal reps.
      if (!weightFlagged) {
        check(rows, i, repsOf, o.repsFactor, o.minRepsJump, (v, max) =>
          `${exercise} set of ${v} reps, against a most of ${max} in the ${o.history} sets before it`
        );
      }
    });
  }
  return findings;
}

const weightOf = (s: SetRow) => s.weightLbs;
const repsOf = (s: SetRow) => s.reps;
