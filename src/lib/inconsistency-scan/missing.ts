import { addDays, daysBetween } from "@/lib/date";
import {
  isDayLogged,
  isFieldFilled,
  type FieldDef,
  type SatelliteDomain,
} from "@/lib/expected-fields";
import { SCAN_FIELDS, type Finding, type ScanInput } from "./types";

/**
 * Type 1 findings, "missing entirely" (#13): a stretch with no day
 * logged at all, and a domain (workouts, books, …) that goes quiet for
 * much longer than it usually does.
 */

export type MissingDayOptions = {
  /** Calendar days before a gap that decide whether you were logging. */
  lookbackDays?: number;
  /**
   * Fraction of those days that must be logged for the gap to count.
   * Below it, the gap is part of a stretch where you weren't logging
   * regularly (the early years, a deliberate break), and flagging it
   * day by day would be noise.
   */
  minLoggedRate?: number;
  fields?: readonly FieldDef[];
};

// Not tunable against production yet: every date from 2016-02-18 to today
// has a logged row, so these produced zero findings at every setting
// tried (0.7 to 0.9). They're here for the gap that hasn't happened.
export const MISSING_DAY_DEFAULTS = { lookbackDays: 30, minLoggedRate: 0.8 } as const;

/**
 * One finding per run of consecutive unlogged dates that follows a
 * regularly logged stretch, keyed on the run's first date. That key stays
 * stable as you fill the gap from its far end, and filling its first day
 * resolves the finding while the rest of the gap is flagged under its new
 * start. One finding per run rather than per day, because a two-week trip
 * you didn't log is one thing to review, not fourteen.
 *
 * Judged from the first logged date onward. Before that is pre-diary, not
 * a gap.
 */
export function detectMissingDays(input: ScanInput, options: MissingDayOptions = {}): Finding[] {
  const {
    lookbackDays = MISSING_DAY_DEFAULTS.lookbackDays,
    minLoggedRate = MISSING_DAY_DEFAULTS.minLoggedRate,
    fields = SCAN_FIELDS,
  } = options;

  const logged = new Set(
    input.snapshots.filter((s) => isDayLogged(s, fields)).map((s) => s.date)
  );
  const first = [...logged].sort()[0];
  if (!first || first > input.lastJudgedDate) return [];

  const findings: Finding[] = [];
  let date = first;
  while (date <= input.lastJudgedDate) {
    if (logged.has(date)) {
      date = addDays(date, 1);
      continue;
    }
    const start = date;
    while (date <= input.lastJudgedDate && !logged.has(date)) date = addDays(date, 1);
    const end = addDays(date, -1);

    let loggedBefore = 0;
    for (let d = addDays(start, -lookbackDays); d < start; d = addDays(d, 1)) {
      if (logged.has(d)) loggedBefore++;
    }
    if (loggedBefore / lookbackDays < minLoggedRate) continue;

    const length = daysBetween(start, end) + 1;
    findings.push({
      type: "missing",
      entityTable: "days",
      date: start,
      detail:
        length === 1
          ? "Day not logged"
          : `${length} days not logged, ${start} to ${end}`,
    });
  }
  return findings;
}

export type DomainGapOptions = {
  /** Domains with fewer entries than this have no usual rhythm to break. */
  minEntries?: number;
  /** A gap is never flagged below this many logged days. */
  floorDays?: number;
  /** The domain's usual gap: this quantile of its own gaps between entries. */
  quantile?: number;
  /** A gap is flagged when longer than this multiple of the usual gap. */
  multiplier?: number;
  fields?: readonly FieldDef[];
};

// Tuned against production history (2016-02 to 2026-10) on #670: a 2x
// multiplier gave 44 gaps over ten years, a reviewable one-off backlog, and
// was the only setting that still caught the one live gap ("no books since
// 2026-08"). 3x dropped to 27 by losing exactly that kind of finding.
export const DOMAIN_GAP_DEFAULTS = {
  minEntries: 20,
  floorDays: 14,
  quantile: 0.9,
  multiplier: 2,
} as const;

/**
 * Sports watching follows league calendars, so its long gaps are off
 * seasons. On production history they were 13 of the 44 domain gaps,
 * every one a summer or winter break. A per-season rhythm could judge
 * sports fairly, but that's beyond what a gap check should know.
 */
const GAP_EXEMPT_DOMAINS: ReadonlySet<SatelliteDomain> = new Set(["sports"]);

/** The q-quantile of `values` by nearest rank. Assumes a non-empty array. */
function quantileOf(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

/**
 * For each satellite domain, a stretch of logged days with no entry at
 * all that's far longer than that domain's own usual gap. Measured in
 * *logged* days, not calendar days, so a week the diary wasn't kept
 * doesn't count against a domain: that's `detectMissingDays`' finding.
 *
 * "Usual" comes from the domain's own history (the 90th-percentile gap by
 * default), so a weekly habit and a daily one are each judged on their
 * own rhythm. A gap still running at the end of the scan is flagged too
 * ("no books since …"), which is how a habit that quietly stopped gets
 * noticed. Dismiss it once, and it stays dismissed as the gap grows,
 * since the key is the gap's first day.
 */
export function detectDomainGaps(input: ScanInput, options: DomainGapOptions = {}): Finding[] {
  const {
    minEntries = DOMAIN_GAP_DEFAULTS.minEntries,
    floorDays = DOMAIN_GAP_DEFAULTS.floorDays,
    quantile = DOMAIN_GAP_DEFAULTS.quantile,
    multiplier = DOMAIN_GAP_DEFAULTS.multiplier,
    fields = SCAN_FIELDS,
  } = options;

  const loggedDays = input.snapshots
    .filter((s) => s.date <= input.lastJudgedDate && isDayLogged(s, fields))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (loggedDays.length === 0) return [];

  const findings: Finding[] = [];
  for (const field of fields) {
    if (field.source !== "satellite" || GAP_EXEMPT_DOMAINS.has(field.domain)) continue;
    // Positions in loggedDays of the days that have this domain.
    const hits: number[] = [];
    loggedDays.forEach((s, i) => {
      if (isFieldFilled(field, s)) hits.push(i);
    });
    if (hits.length < minEntries) continue;

    // Logged days with no entry between consecutive hits, plus the
    // trailing run after the last one.
    const gaps = hits.slice(1).map((h, i) => h - hits[i] - 1);
    const threshold = Math.max(floorDays, multiplier * quantileOf(gaps, quantile));
    const runs = hits.slice(1).map((h, i) => ({ from: hits[i] + 1, to: h - 1 }));
    runs.push({ from: hits[hits.length - 1] + 1, to: loggedDays.length - 1 });

    const label = field.label.toLowerCase();
    for (const run of runs) {
      const length = run.to - run.from + 1;
      if (length <= threshold) continue;
      const start = loggedDays[run.from].date;
      const ongoing = run.to === loggedDays.length - 1;
      findings.push({
        type: "missing",
        entityTable: "days",
        date: start,
        field: field.key,
        detail: ongoing
          ? `No ${label} since ${start} (${length} logged days)`
          : `No ${label} for ${length} logged days, ${start} to ${loggedDays[run.to].date}`,
      });
    }
  }
  return findings;
}
