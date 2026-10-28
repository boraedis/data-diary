import type { InconsistencyStatus, InconsistencyType } from "@/db/schema";
import { SUB_NAMES } from "@/lib/days";
import { FIELDS } from "@/lib/expected-fields";

/**
 * Where the review page (#672) sends you to fix a finding, and how it
 * names things. Pure, but server-side only: SUB_NAMES comes from days.ts,
 * which imports the database client (see journal-href.ts on why that
 * matters for a client bundle). The page resolves links on the server
 * and hands the client components plain strings.
 *
 * Everything the scan judges is edited on a day page: day fields in that
 * day's section forms, and every satellite entry (workouts, movie watches,
 * …) in the day it belongs to. So a link is always `/day/<date>`, plus the
 * section when the finding names one. A finding that spans several
 * sections (a partially filled day) goes to the day's overview, which
 * shows every section's progress at a glance.
 */

type Section =
  | "sleep"
  | "social-media"
  | "weight"
  | "technology"
  | "health"
  | "happiness"
  | "journal"
  | "subs"
  | "entertainment"
  | "places"
  | "people"
  | "work";

// Keyed by everything a finding's `field` can hold: registry field keys,
// `days` column names (outliers), satellite domains (gaps, totals) and
// entry columns, which resolve through the entity table instead.
const FIELD_SECTIONS: Record<string, Section> = {
  sleep: "sleep",
  sleepTime: "sleep",
  wakeTime: "sleep",
  sleepLocation: "sleep",
  nap: "sleep",
  napMinutes: "sleep",
  instagramFollowers: "social-media",
  instagramFollowing: "social-media",
  weight: "weight",
  weightKg: "weight",
  bodyFat: "weight",
  bodyFatPercent: "weight",
  muscleMass: "weight",
  muscleMassKg: "weight",
  phoneUsage: "technology",
  phoneUsageMinutes: "technology",
  laptopUsage: "technology",
  laptopUsageMinutes: "technology",
  instagramUsage: "technology",
  instagramUsageMinutes: "technology",
  distanceWalked: "health",
  distanceWalkedKm: "health",
  coffees: "health",
  sick: "health",
  workouts: "health",
  happiness: "happiness",
  happinessReason: "happiness",
  dayType: "happiness",
  journal: "journal",
  productivity: "work",
  workDuration: "work",
  workDurationMinutes: "work",
  workLocation: "work",
  commute: "work",
  positivePeople: "people",
  negativePeople: "people",
  places: "places",
  entertainment: "entertainment",
  movies: "entertainment",
  tv: "entertainment",
  books: "entertainment",
  games: "entertainment",
  sports: "entertainment",
  ...Object.fromEntries(SUB_NAMES.map((n) => [`sub${n}`, "subs" as const])),
};

const TABLE_SECTIONS: Record<string, Section> = {
  workouts: "health",
  workout_sets: "health",
  movie_watches: "entertainment",
  tv_episode_watches: "entertainment",
  book_reading_sessions: "entertainment",
  game_sessions: "entertainment",
  sports_watches: "entertainment",
  entertainment_entries: "entertainment",
};

// Registry labels back to keys, for reading a partial finding's detail.
const FIELD_BY_LABEL = new Map(FIELDS.map((f) => [f.label, f.key]));

/**
 * The fields a "partially filled" finding lists, each with the day
 * section that fixes it (#685). The finding stores them only as its
 * detail text ("Missing: Weight, Sub K", built in partial.ts from
 * registry labels), because its `field` stays null so the finding keeps
 * its identity as the list changes. Registry labels contain no commas, so
 * splitting the detail recovers them exactly. A label that no longer
 * matches the registry (renamed since the scan ran) comes back without a
 * link rather than a wrong one.
 */
export function partialFieldLinks(f: {
  date: string | null;
  detail: string;
}): { label: string; href: string | null }[] {
  const prefix = "Missing: ";
  if (!f.detail.startsWith(prefix)) return [];
  return f.detail
    .slice(prefix.length)
    .split(", ")
    .map((label) => {
      const key = FIELD_BY_LABEL.get(label);
      const section = key ? FIELD_SECTIONS[key] : undefined;
      return { label, href: f.date && section ? `/day/${f.date}/${section}` : null };
    });
}

export function findingHref(f: {
  type?: InconsistencyType;
  date: string | null;
  entityTable: string;
  field: string | null;
  detail?: string;
}): string | null {
  if (!f.date) return null;
  // A partial day whose missing fields all sit in one section links
  // there; one spanning several goes to the overview, which shows every
  // section's progress.
  if (f.type === "partial" && f.detail) {
    const hrefs = new Set(partialFieldLinks({ date: f.date, detail: f.detail }).map((l) => l.href));
    const [only] = hrefs;
    return hrefs.size === 1 && only ? only : `/day/${f.date}`;
  }
  const section =
    f.entityTable === "days" ? (f.field ? FIELD_SECTIONS[f.field] : undefined) : TABLE_SECTIONS[f.entityTable];
  return section ? `/day/${f.date}/${section}` : `/day/${f.date}`;
}

/** Group headings on the review page, in the order they're shown. */
export const TYPE_LABELS: Record<InconsistencyType, { title: string; blurb: string }> = {
  missing: {
    title: "Missing",
    blurb: "Days with nothing logged, and domains that went quiet for far longer than usual.",
  },
  partial: {
    title: "Partially filled",
    blurb: "Logged days missing fields you fill in on nearly every day around them.",
  },
  outlier: {
    title: "Outlier values",
    blurb: "Impossible values, and readings far from your own readings around them.",
  },
  referential: {
    title: "Odd entries",
    blurb: "Entries missing what their siblings have, and workout sets far past your recent ones.",
  },
};

export const FINDING_TYPES = Object.keys(TYPE_LABELS) as InconsistencyType[];

export const FINDING_STATUSES: readonly InconsistencyStatus[] = ["open", "dismissed", "resolved"];

export function parseFindingStatus(value: unknown): InconsistencyStatus | null {
  return FINDING_STATUSES.includes(value as InconsistencyStatus) ? (value as InconsistencyStatus) : null;
}

/**
 * The statuses you can set by hand: dismiss, and reopen (undo a
 * dismissal). "resolved" is the scan's alone (#685). It resolves any open
 * finding that stops reproducing, so marking one fixed by hand only hid
 * it until the next scan, which reopened it if it wasn't really fixed.
 */
export type ReviewStatus = Exclude<InconsistencyStatus, "resolved">;

export function parseReviewStatus(value: unknown): ReviewStatus | null {
  return value === "open" || value === "dismissed" ? value : null;
}
