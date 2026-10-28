import { MAX_DAILY_MINUTES } from "@/lib/duration-limits";
import type { DayColumn } from "@/lib/expected-fields";
import { SUB_NAMES } from "@/lib/days";
import { daysBetween } from "@/lib/date";
import { formatDuration } from "@/lib/viz/format";
import { ENTRY_TABLES, type Finding, type ScanInput } from "./types";

/**
 * Type 3 findings, "outlier value" (#13), v1's basic version: a value
 * that's impossible (range checks), and one that's possible but far from
 * your own recent readings (`detectRollingOutliers`), which is the
 * typo-shaped case ("84.1" entered as "94.1"). Smarter statistical
 * detection is a later refinement, per the issue.
 */

type Range = { column: DayColumn; label: string; min: number; max: number; unit?: string };

// What a value can be at all, not what's typical. Most of these are
// enforced at write time now, but years of rows predate the validators.
// The body-measure bounds are wide on purpose: they catch a unit slip
// (pounds typed into a kg field) or a stray digit, not a real change.
const DAY_RANGES: readonly Range[] = [
  { column: "happiness", label: "Happiness", min: 0, max: 100 },
  { column: "productivity", label: "Productivity", min: 0, max: 100 },
  ...SUB_NAMES.map((n) => ({ column: `sub${n}` as DayColumn, label: `Sub ${n}`, min: 0, max: 10 })),
  { column: "coffees", label: "Coffees", min: 0, max: 15 },
  { column: "distanceWalkedKm", label: "Distance walked", min: 0, max: 80, unit: "km" },
  { column: "weightKg", label: "Weight", min: 35, max: 200, unit: "kg" },
  { column: "bodyFatPercent", label: "Body fat", min: 3, max: 60, unit: "%" },
  { column: "muscleMassKg", label: "Muscle mass", min: 10, max: 120, unit: "kg" },
  { column: "instagramFollowers", label: "Instagram followers", min: 0, max: Infinity },
  { column: "instagramFollowing", label: "Instagram following", min: 0, max: Infinity },
  ...(
    [
      ["napMinutes", "Nap"],
      ["workDurationMinutes", "Work duration"],
      ["phoneUsageMinutes", "Phone usage"],
      ["laptopUsageMinutes", "Laptop usage"],
      ["instagramUsageMinutes", "Instagram usage"],
    ] as const
  ).map(([column, label]) => ({ column, label, min: 0, max: MAX_DAILY_MINUTES, unit: "min" })),
];

const TIME_COLUMNS = [
  ["sleepTime", "Sleep time"],
  ["wakeTime", "Wake time"],
] as const;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function show(value: number, unit?: string): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : n;
}

/** Whether `value` is outside its range, for the rolling check to skip. */
function outOfRange(r: Range, value: number): boolean {
  return !Number.isFinite(value) || value < r.min || value > r.max;
}

/**
 * Impossible values: a day field outside what it can be, a clock time
 * that isn't one, a satellite entry lasting no time or more than a day,
 * and a domain's entries adding up to more than a day. The duration
 * rules are #588's write-time limits (duration-limits.ts), applied to the
 * rows that predate them, which that module's header leaves to this scan.
 */
export function detectRangeOutliers(input: ScanInput): Finding[] {
  const findings: Finding[] = [];
  for (const s of input.snapshots) {
    if (s.date > input.lastJudgedDate || !s.day) continue;
    for (const r of DAY_RANGES) {
      const v = s.day[r.column];
      if (typeof v !== "number" || !outOfRange(r, v)) continue;
      const bound = r.max === Infinity ? `at least ${show(r.min, r.unit)}` : `${show(r.min, r.unit)} to ${show(r.max, r.unit)}`;
      findings.push({
        type: "outlier",
        entityTable: "days",
        date: s.date,
        field: r.column,
        detail: `${r.label} is ${show(v, r.unit)}, outside ${bound}`,
      });
    }
    for (const [column, label] of TIME_COLUMNS) {
      const v = s.day[column];
      if (typeof v === "string" && !CLOCK_TIME.test(v)) {
        findings.push({
          type: "outlier",
          entityTable: "days",
          date: s.date,
          field: column,
          detail: `${label} "${v}" isn't a valid HH:MM time`,
        });
      }
    }
  }

  const totals = new Map<string, number>(); // `${table}|${date}` → minutes
  for (const e of input.entries ?? []) {
    if (e.date > input.lastJudgedDate || e.durationMinutes === null) continue;
    const m = e.durationMinutes;
    const { label } = ENTRY_TABLES[e.table];
    if (!Number.isInteger(m) || m <= 0 || m > MAX_DAILY_MINUTES) {
      findings.push({
        type: "outlier",
        entityTable: e.table,
        entityId: e.id,
        date: e.date,
        field: "durationMinutes",
        detail: `${label} lasts ${m > 0 ? formatDuration(m / 60) : `${m} minutes`}, outside 1 minute to 24h`,
      });
      continue; // already wrong on its own; don't also count it towards the day
    }
    const key = `${e.table}|${e.date}`;
    totals.set(key, (totals.get(key) ?? 0) + m);
  }
  for (const [key, minutes] of totals) {
    if (minutes <= MAX_DAILY_MINUTES) continue;
    const [table, date] = key.split("|") as [keyof typeof ENTRY_TABLES, string];
    findings.push({
      type: "outlier",
      entityTable: "days",
      date,
      field: ENTRY_TABLES[table].domain,
      detail: `${ENTRY_TABLES[table].label}s add up to ${formatDuration(minutes / 60)} in one day`,
    });
  }
  return findings;
}

type Rolling = {
  column: DayColumn;
  label: string;
  unit?: string;
  /**
   * The smallest deviation ever flagged, from the typical value: a
   * stable series has a tiny spread, and a 0.3 kg wobble mustn't read as
   * an outlier just because the last ten readings were identical.
   */
  floor: (typical: number) => number;
};

// The measures where a typo is plausible and a real day-to-day swing is
// small. Happiness and productivity are left out on purpose: they're
// daily judgements, so "far from your recent average" is a bad day, not
// a mistake. Checked on production for #671: z = 5 would have flagged
// 65 happiness days, every one inside the 47 to 100 it actually ranges
// over. Productivity has only ~100 readings.
//
// The floors do most of the work on clean data. On production (weight
// 71 to 87 kg over 1,366 readings) the largest deviations reach z ≈ 11
// because the spread is tiny, but none is 3 kg, and the check flagged
// nothing. A 94.1 typed for 84.1 is 10 kg out and would be caught.
const ROLLING_FIELDS: readonly Rolling[] = [
  { column: "weightKg", label: "Weight", unit: "kg", floor: () => 3 },
  { column: "bodyFatPercent", label: "Body fat", unit: "%", floor: () => 3 },
  { column: "muscleMassKg", label: "Muscle mass", unit: "kg", floor: () => 3 },
  { column: "instagramFollowers", label: "Instagram followers", floor: (m) => Math.max(25, m * 0.05) },
  { column: "instagramFollowing", label: "Instagram following", floor: (m) => Math.max(25, m * 0.05) },
];

export type RollingOptions = {
  /** Readings before (and after) a value that it's compared with. */
  neighbours?: number;
  /** Fewer readings than this before it, and a value isn't judged. */
  minHistory?: number;
  /** Readings further than this from the value don't count as recent. */
  windowDays?: number;
  /** Robust z-score (median and MAD) beyond which a value is flagged. */
  z?: number;
};

export const ROLLING_DEFAULTS = { neighbours: 10, minHistory: 5, windowDays: 60, z: 5 } as const;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * A reading far from your own recent readings: further from their
 * median than `z` robust standard deviations (1.4826 × MAD), and further
 * than the field's floor.
 *
 * Two-sided on purpose. If the readings *after* it agree with it, the
 * value is a real change (a diet, a follower purge) rather than a typo,
 * and isn't flagged. A typo is isolated, and the next reading goes back
 * to where the series was. The newest reading has nothing after it yet,
 * so it's judged on the readings before it alone.
 */
export function detectRollingOutliers(input: ScanInput, options: RollingOptions = {}): Finding[] {
  const {
    neighbours = ROLLING_DEFAULTS.neighbours,
    minHistory = ROLLING_DEFAULTS.minHistory,
    windowDays = ROLLING_DEFAULTS.windowDays,
    z = ROLLING_DEFAULTS.z,
  } = options;
  const ranges = new Map(DAY_RANGES.map((r) => [r.column, r]));
  const sorted = [...input.snapshots].sort((a, b) => (a.date < b.date ? -1 : 1));

  const findings: Finding[] = [];
  for (const f of ROLLING_FIELDS) {
    const range = ranges.get(f.column);
    const series: { date: string; value: number }[] = [];
    for (const s of sorted) {
      const v = s.day?.[f.column];
      // Impossible values are the range check's finding, and would skew
      // every median around them.
      if (typeof v === "number" && !(range && outOfRange(range, v))) series.push({ date: s.date, value: v });
    }

    const near = (from: number, to: number, date: string) =>
      series
        .slice(Math.max(0, from), Math.max(0, to))
        .filter((p) => Math.abs(daysBetween(p.date, date)) <= windowDays)
        .map((p) => p.value);

    series.forEach((point, i) => {
      if (point.date > input.lastJudgedDate) return;
      const before = near(i - neighbours, i, point.date);
      if (before.length < minHistory) return;
      const typical = median(before);
      const spread = 1.4826 * median(before.map((v) => Math.abs(v - typical)));
      const threshold = Math.max(f.floor(typical), z * spread);
      if (Math.abs(point.value - typical) <= threshold) return;

      const after = near(i + 1, i + 1 + neighbours, point.date);
      if (after.length > 0 && Math.abs(median(after) - point.value) <= threshold) return;

      findings.push({
        type: "outlier",
        entityTable: "days",
        date: point.date,
        field: f.column,
        detail: `${f.label} ${show(point.value, f.unit)}, against a typical ${show(typical, f.unit)} around it`,
      });
    });
  }
  return findings;
}
