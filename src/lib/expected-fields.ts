import type { days } from "@/db/schema";
import { NEGATIVE_PEOPLE_SLOTS, PLACE_SLOTS, POSITIVE_PEOPLE_SLOTS, SUB_NAMES } from "@/lib/days";
import { addDays } from "@/lib/date";

/**
 * The one shared answer to "what does a logged day have filled in" (#669,
 * part of the inconsistency-scan epic #13). Before this, `/home`'s Days
 * Behind widget had its own private 10-section scorer in home.ts and the
 * scan would have needed a second one; two definitions of "filled" drift
 * apart the first time a field is added to the day form.
 *
 * Two layers:
 * - **Fields**: one entry per thing you log, granular enough that "you
 *   filled 8 of 9 subs" is a finding. Day fields read `days` columns;
 *   satellite fields read a per-date row count for a domain that lives in
 *   its own table (workouts, movie watches, …). Loading those counts is
 *   the scan's job, not this module's. Home doesn't need them, and keeping
 *   them out of home.ts keeps its 90-day query a single-table read.
 * - **Groupings** over fields: `HOME_SECTIONS` is the home dashboard's
 *   10-section completion score, kept as a named grouping so the score
 *   means what it always has, while the scan works field by field.
 *
 * What counts as "expected" is not a fixed list: it's your own trailing
 * fill rate (`expectedFieldsByDate`), because you didn't always track
 * everything you track now, and a field you fill 10% of the time isn't
 * missing when it's empty.
 *
 * Pure: no DB access, so it's shared by server pages and the scan runner
 * alike and testable on fixtures.
 */

/** A `days` column name (excluding the key and bookkeeping timestamps). */
export type DayColumn = Exclude<
  keyof typeof days.$inferSelect,
  "date" | "createdAt" | "updatedAt"
>;

/**
 * The domains logged in their own per-date tables rather than on `days`.
 * A day "has" one when it has at least one row there.
 */
export const SATELLITE_DOMAINS = [
  "workouts",
  "entertainment",
  "movies",
  "tv",
  "books",
  "games",
  "sports",
  "music",
] as const;
export type SatelliteDomain = (typeof SATELLITE_DOMAINS)[number];

/**
 * Everything the registry needs to know about one date. `day` is the
 * `days` row (or null when there isn't one), holding at least the columns
 * the fields being checked read; `satellites` is a row count per domain,
 * where a missing key means zero.
 */
export type DaySnapshot = {
  date: string;
  day: Partial<Record<DayColumn, unknown>> | null;
  satellites?: Partial<Record<SatelliteDomain, number>>;
};

export type FieldDef =
  | {
      key: string;
      label: string;
      source: "day";
      // Filled when any of these is set. Grouped columns (the people
      // slots, sleep + wake time) are one field because you log them as
      // one thing; flagging "positive person 4 is empty" would be noise.
      columns: readonly DayColumn[];
    }
  | { key: string; label: string; source: "satellite"; domain: SatelliteDomain };

function dayField(key: string, label: string, ...columns: DayColumn[]): FieldDef {
  return { key, label, source: "day", columns };
}

function slotColumns(prefix: string, count: number): DayColumn[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}Id` as DayColumn);
}

// The sub columns are named after SUB_NAMES themselves (subA, subNi, …),
// see schema.ts.
const SUB_FIELDS: FieldDef[] = SUB_NAMES.map((name) =>
  dayField(`sub${name}`, `Sub ${name}`, `sub${name}` as DayColumn)
);

export const FIELDS: readonly FieldDef[] = [
  // Health
  dayField("distanceWalked", "Distance walked", "distanceWalkedKm"),
  dayField("coffees", "Coffees", "coffees"),
  dayField("sick", "Sick", "sick"),
  // Sleep
  dayField("sleep", "Sleep times", "sleepTime", "wakeTime"),
  dayField("sleepLocation", "Sleep location", "sleepLocationType"),
  dayField("nap", "Nap", "napMinutes"),
  // Happiness
  dayField("happiness", "Happiness", "happiness"),
  dayField("happinessReason", "Happiness reason", "happinessReason"),
  dayField("journal", "Journal", "journal"),
  dayField("dayType", "Day type", "dayType"),
  // Work
  dayField("productivity", "Productivity", "productivity"),
  dayField("workDuration", "Work duration", "workDurationMinutes"),
  dayField("workLocation", "Work location", "workLocation"),
  dayField("commute", "Commute", "commute"),
  // Technology
  dayField("phoneUsage", "Phone usage", "phoneUsageMinutes"),
  dayField("laptopUsage", "Laptop usage", "laptopUsageMinutes"),
  dayField("instagramUsage", "Instagram usage", "instagramUsageMinutes"),
  // Weight
  dayField("weight", "Weight", "weightKg"),
  dayField("bodyFat", "Body fat", "bodyFatPercent"),
  dayField("muscleMass", "Muscle mass", "muscleMassKg"),
  // Social media
  dayField("instagramFollowers", "Instagram followers", "instagramFollowers"),
  dayField("instagramFollowing", "Instagram following", "instagramFollowing"),
  // People, places, subs
  dayField(
    "positivePeople",
    "Positive people",
    ...slotColumns("positivePerson", POSITIVE_PEOPLE_SLOTS)
  ),
  dayField(
    "negativePeople",
    "Negative people",
    ...slotColumns("negativePerson", NEGATIVE_PEOPLE_SLOTS)
  ),
  dayField("places", "Places", ...slotColumns("place", PLACE_SLOTS)),
  ...SUB_FIELDS,
  // Satellite domains
  { key: "workouts", label: "Workouts", source: "satellite", domain: "workouts" },
  { key: "entertainment", label: "Entertainment", source: "satellite", domain: "entertainment" },
  { key: "movies", label: "Movies", source: "satellite", domain: "movies" },
  { key: "tv", label: "TV", source: "satellite", domain: "tv" },
  { key: "books", label: "Books", source: "satellite", domain: "books" },
  { key: "games", label: "Games", source: "satellite", domain: "games" },
  { key: "sports", label: "Sports", source: "satellite", domain: "sports" },
  { key: "music", label: "Music", source: "satellite", domain: "music" },
];

export const DAY_FIELDS = FIELDS.filter(
  (f): f is Extract<FieldDef, { source: "day" }> => f.source === "day"
);

const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function getField(key: string): FieldDef | undefined {
  return FIELD_BY_KEY.get(key);
}

/** Every `days` column the given fields read, deduplicated, in field order. */
export function columnsFor(fields: readonly FieldDef[]): DayColumn[] {
  const out = new Set<DayColumn>();
  for (const f of fields) if (f.source === "day") for (const c of f.columns) out.add(c);
  return [...out];
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  // Enum-array columns (workLocation, commute) are "not logged" when empty.
  if (Array.isArray(v)) return v.length > 0;
  // A whitespace-only journal or reason is an accidental keystroke, not an entry.
  if (typeof v === "string") return v.trim().length > 0;
  // `sick` is tri-state: false is a recorded answer, so it counts.
  return true;
}

export function isFieldFilled(field: FieldDef, snapshot: DaySnapshot): boolean {
  if (field.source === "satellite") return (snapshot.satellites?.[field.domain] ?? 0) > 0;
  const day = snapshot.day;
  if (!day) return false;
  return field.columns.some((c) => hasValue(day[c]));
}

/** A day counts as logged once any field at all is filled. */
export function isDayLogged(snapshot: DaySnapshot, fields: readonly FieldDef[] = FIELDS): boolean {
  return fields.some((f) => isFieldFilled(f, snapshot));
}

// --- Home completion score -------------------------------------------------

/**
 * The home dashboard's 10 completion sections, one point each. This is
 * the scorer that used to be private to home.ts, unchanged in spirit: a
 * section counts once any of its fields is filled, and Days Behind treats
 * a day scoring under `HOME_LOGGED_SCORE` as not caught up. Satellite
 * domains stay out of it on purpose (see the header for why home skips
 * them).
 *
 * One deliberate difference from the old scorer: people, places and subs
 * now count any slot, where it only checked positive person 1, place 1
 * and sub A. A day whose first slot happens to be empty is still logged.
 */
export const HOME_SECTIONS: readonly { label: string; fields: readonly string[] }[] = [
  { label: "Happiness", fields: ["happiness"] },
  { label: "Sleep", fields: ["sleep"] },
  { label: "Health", fields: ["distanceWalked", "coffees", "sick"] },
  { label: "Work", fields: ["productivity", "workDuration"] },
  { label: "People", fields: ["positivePeople"] },
  { label: "Places", fields: ["places"] },
  { label: "Subs", fields: SUB_FIELDS.map((f) => f.key) },
  { label: "Weight", fields: ["weight"] },
  { label: "Technology", fields: ["phoneUsage", "laptopUsage"] },
  { label: "Social media", fields: ["instagramFollowers"] },
];

export const HOME_SECTION_COUNT = HOME_SECTIONS.length;
export const HOME_LOGGED_SCORE = 5;

const HOME_SECTION_FIELDS = HOME_SECTIONS.map((s) =>
  s.fields.map((k) => FIELD_BY_KEY.get(k)!)
);

/** Every `days` column the home score reads: what home.ts selects. */
export const HOME_SCORE_COLUMNS = columnsFor(HOME_SECTION_FIELDS.flat());

/** 0..HOME_SECTION_COUNT sections filled; 0 for a date with no row. */
export function scoreDay(day: DaySnapshot["day"]): number {
  if (!day) return 0;
  const snapshot: DaySnapshot = { date: "", day };
  return HOME_SECTION_FIELDS.filter((fields) => fields.some((f) => isFieldFilled(f, snapshot)))
    .length;
}

// --- Fill-rate expectations ------------------------------------------------

export type ExpectationOptions = {
  /**
   * Trailing calendar days (before the date being judged, not including
   * it) whose logged days set the expectation. 90 tracks a habit change
   * within a season without one odd week swinging it.
   */
  windowDays?: number;
  /**
   * Fill rate, over logged days in the window, above which a field is
   * expected. 0.8 means a field you skip more than one logged day in five
   * isn't flagged when empty. A starting default, to be tuned against
   * real history by the detectors (#670).
   */
  cutoff?: number;
  /**
   * Fewer logged days than this in the window and nothing is expected:
   * three logged days out of 90 can't say what your habits are, and
   * flagging off them would be noise.
   */
  minLoggedDays?: number;
  fields?: readonly FieldDef[];
};

export const DEFAULT_EXPECTATION_OPTIONS = {
  windowDays: 90,
  cutoff: 0.8,
  minLoggedDays: 30,
} as const;

/**
 * Fill rate per field over `snapshots`, as a fraction of the *logged* days
 * among them. Unlogged days are left out of the denominator on purpose: a
 * day with nothing at all is the "missing" finding, and counting it here
 * too would lower every field's rate during a gap.
 */
export function fillRates(
  snapshots: readonly DaySnapshot[],
  fields: readonly FieldDef[] = FIELDS
): { loggedDays: number; rates: Map<string, number> } {
  const counts = new Map(fields.map((f) => [f.key, 0]));
  let loggedDays = 0;
  for (const s of snapshots) {
    if (!isDayLogged(s, fields)) continue;
    loggedDays++;
    for (const f of fields) if (isFieldFilled(f, s)) counts.set(f.key, counts.get(f.key)! + 1);
  }
  const rates = new Map<string, number>();
  for (const [key, n] of counts) rates.set(key, loggedDays === 0 ? 0 : n / loggedDays);
  return { loggedDays, rates };
}

/**
 * For each snapshot's date, the field keys expected on it: fields whose
 * fill rate over the trailing window is above the cutoff. Snapshots can
 * be sparse (dates with no row simply absent) and in any order.
 *
 * Done as one sliding window over the sorted dates rather than calling
 * `fillRates` per date, since the scan runs this over the full history:
 * O(dates × fields), not O(dates × window × fields).
 */
export function expectedFieldsByDate(
  snapshots: readonly DaySnapshot[],
  options: ExpectationOptions = {}
): Map<string, Set<string>> {
  const {
    windowDays = DEFAULT_EXPECTATION_OPTIONS.windowDays,
    cutoff = DEFAULT_EXPECTATION_OPTIONS.cutoff,
    minLoggedDays = DEFAULT_EXPECTATION_OPTIONS.minLoggedDays,
    fields = FIELDS,
  } = options;

  // Only logged days feed the window, each reduced to which fields it had.
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const filledByIndex = sorted.map((s) =>
    isDayLogged(s, fields) ? fields.map((f) => isFieldFilled(f, s)) : null
  );

  const counts = new Array<number>(fields.length).fill(0);
  let loggedInWindow = 0;
  let head = 0; // first index still inside the window
  let tail = 0; // first index not yet added (always < the date being judged)
  const result = new Map<string, Set<string>>();

  const apply = (i: number, sign: 1 | -1) => {
    const filled = filledByIndex[i];
    if (!filled) return;
    loggedInWindow += sign;
    for (let f = 0; f < fields.length; f++) if (filled[f]) counts[f] += sign;
  };

  for (let i = 0; i < sorted.length; i++) {
    const date = sorted[i].date;
    const windowStart = addDays(date, -windowDays);
    while (tail < sorted.length && sorted[tail].date < date) apply(tail++, 1);
    while (head < tail && sorted[head].date < windowStart) apply(head++, -1);

    const expected = new Set<string>();
    if (loggedInWindow >= minLoggedDays) {
      for (let f = 0; f < fields.length; f++) {
        if (counts[f] / loggedInWindow > cutoff) expected.add(fields[f].key);
      }
    }
    result.set(date, expected);
  }
  return result;
}
