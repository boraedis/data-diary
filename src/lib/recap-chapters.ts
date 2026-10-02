import { asc } from "drizzle-orm";
import { days } from "@/db/schema";
import { todayDateString } from "@/lib/date";
import { getDb } from "@/lib/db";
import { chainRoleEnds } from "@/lib/life-timeline";
import {
  listProfileOccupations,
  listProfileRelationships,
  listProfileResidences,
  type ProfileOccupationItem,
  type ProfileRelationshipItem,
  type ProfileResidenceItem,
} from "@/lib/profile";
import { describeSpan, isPeriodPublished, periodLengthDays, type RecapPeriod } from "@/lib/recap";
import { lifeEntryKey } from "@/lib/recap-life-events";
import { formatDate } from "@/lib/viz/format";

// Life-chapter recaps (#519, epic #130 follow-up): "my time at <job>", "my
// years in <city>", "the relationship", each as its own recap.
//
// A chapter is nothing more than a `RecapPeriod` sourced from a profile
// interval instead of the calendar. Every recap fetcher already takes a
// period, so this module's whole job is deciding *which* windows exist,
// what they're called, and when each one is finished. `RecapReport` and the
// story builder render them unchanged, with the handful of chapter-specific
// display choices made there (see `RecapScope`).
//
// Chapters are independent views, not a partition: a job and a home run
// concurrently, and so — in this data — do jobs (a side job alongside a
// full-time one). Nothing here tries to make them tile the timeline.

/** What a chapter is a chapter *of*. Education is its own kind, as in the
 * life-events card (#560) — a degree isn't "my time at a job". */
export type RecapChapterKind = "work" | "education" | "role" | "residence" | "relationship";

export type RecapChapter = {
  /** `lifeEntryKey` of the source row — also the route segment, and how
   * the chapter's report recognises its own life event to leave it out. */
  key: string;
  kind: RecapChapterKind;
  /** The entry's alias when it has one, else its name: the same
   * shorter-label-wins rule the life-events card uses. A role is titled
   * "<position> at <job>", since a position alone ("Senior Engineer")
   * doesn't say which job it was. */
  title: string;
  /** Supporting line for the index: position, place or person. */
  detail: string | null;
  start: string;
  /** Resolved end, or null while the chapter is still going. For a role
   * this is `chainRoleEnds`' answer, never the row's raw (usually null)
   * `end`. */
  end: string | null;
  /** A role's job, so the index can list promotions under the job they
   * happened in. Null for everything else. */
  parentKey: string | null;
  color: string | null;
};

/**
 * Every chapter the profile describes, oldest first.
 *
 * **End dates.** Jobs, homes and relationships are taken at their recorded
 * `end`, with null meaning ongoing — they are *not* chained "until the next
 * one begins". That rule belongs to roles, which are points in time inside
 * one job; jobs overlap each other in this data (a part-time job alongside
 * a full-time one), so chaining them would end a job the day an unrelated
 * one started. Roles go through `chainRoleEnds`, the life-timeline's own
 * rule, so a role chapter is exactly the bar the life-timeline draws for it.
 *
 * **Roles** become chapters only for a job with two or more of them. A job
 * with one role has one span, and that role's chapter would be the job's
 * chapter again under a different title.
 */
export function buildChapters({
  occupations,
  residences,
  relationships,
}: {
  occupations: Pick<
    ProfileOccupationItem,
    "id" | "name" | "type" | "alias" | "position" | "company" | "placeName" | "start" | "end" | "color" | "roles"
  >[];
  residences: Pick<ProfileResidenceItem, "id" | "name" | "alias" | "placeName" | "start" | "end" | "color">[];
  relationships: Pick<ProfileRelationshipItem, "id" | "name" | "alias" | "personName" | "start" | "end" | "color">[];
}): RecapChapter[] {
  const chapters: RecapChapter[] = [];

  for (const occupation of occupations) {
    const key = lifeEntryKey("occupation", occupation.id);
    const title = occupation.alias ?? occupation.name;
    chapters.push({
      key,
      kind: occupation.type === "education" ? "education" : "work",
      title,
      detail: occupation.position ?? occupation.company ?? occupation.placeName,
      start: occupation.start,
      end: occupation.end,
      parentKey: null,
      color: occupation.color,
    });
    if (occupation.roles.length < 2) continue;
    for (const role of chainRoleEnds(occupation.roles, occupation.end)) {
      chapters.push({
        key: lifeEntryKey("role", role.id),
        kind: "role",
        title: `${role.position} at ${title}`,
        detail: role.position,
        start: role.start,
        end: role.end,
        parentKey: key,
        color: occupation.color,
      });
    }
  }

  for (const residence of residences) {
    chapters.push({
      key: lifeEntryKey("residence", residence.id),
      kind: "residence",
      title: residence.alias ?? residence.name,
      detail: residence.placeName,
      start: residence.start,
      end: residence.end,
      parentKey: null,
      color: residence.color,
    });
  }

  for (const relationship of relationships) {
    chapters.push({
      key: lifeEntryKey("relationship", relationship.id),
      kind: "relationship",
      title: relationship.alias ?? relationship.name,
      detail: relationship.personName,
      start: relationship.start,
      end: relationship.end,
      parentKey: null,
      color: relationship.color,
    });
  }

  return chapters.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
}

/**
 * The chapter as a recap period.
 *
 * An ongoing chapter is given `today` as its end — "the chapter so far" —
 * which is only ever rendered behind the preview banner: the gate holds
 * it back until there's a real end (see `isChapterPublished`).
 */
export function chapterPeriod(chapter: RecapChapter, today: string): RecapPeriod {
  return { start: chapter.start, end: chapter.end ?? today, label: chapter.title };
}

/**
 * Whether a chapter's recap is out: it has ended, and the publish gate's
 * grace window (#517) has passed since. The same rule as a year or a
 * month, applied to the chapter's own end — an ongoing chapter is in
 * progress, not published, however long it has run.
 */
export function isChapterPublished(chapter: RecapChapter, today: string): boolean {
  return chapter.end !== null && isPeriodPublished(chapterPeriod(chapter, today), today);
}

/**
 * Below this, a chapter is told at month scale: the shorter story and the
 * month's trimmed report (no travel map, no sub movers). A season-long
 * job or relationship is month-sized in what it can honestly say — most of
 * its averages sit near `MIN_DAYS_FOR_AVERAGE` and its "biggest mover"
 * would be a few days either side — while a chapter of a year or more has
 * everything a year has.
 */
export const COMPACT_CHAPTER_MAX_DAYS = 120;

export function isCompactChapter(period: RecapPeriod): boolean {
  return periodLengthDays(period) < COMPACT_CHAPTER_MAX_DAYS;
}

/** How many dates in a sorted list fall in [start, end]. Binary search,
 * because the index counts this once per chapter against every logged day. */
export function countDatesInRange(sortedDates: string[], start: string, end: string): number {
  const lowerBound = (target: string, inclusive: boolean) => {
    let lo = 0;
    let hi = sortedDates.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const before = inclusive ? sortedDates[mid] < target : sortedDates[mid] <= target;
      if (before) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return lowerBound(end, false) - lowerBound(start, true);
}

export type RecapChapterSummary = RecapChapter & {
  period: RecapPeriod;
  loggedDays: number;
  lengthDays: number;
};

/**
 * The chapters index: every published chapter that overlaps the logged
 * history, oldest first, with how much of it was logged.
 *
 * Derived from the profile tables, the same derive-from-the-data rule as
 * `listRecapYears` — no hand-curated list. Two filters:
 *
 * - **Published only** (`isChapterPublished`): the current job and home
 *   don't appear until they end. Their pages still exist for `?preview=1`.
 * - **At least one logged day.** A job that ended before the diary began
 *   has nothing to recap, and listing it would be a dead link. A chapter
 *   that merely *started* before logging did is kept, with its honest
 *   logged-day count beside its length — the report's coverage rules
 *   already handle a chapter that's mostly unlogged.
 */
export function summarizeChapters(
  chapters: RecapChapter[],
  sortedLoggedDates: string[],
  today: string
): RecapChapterSummary[] {
  return chapters
    .filter((chapter) => isChapterPublished(chapter, today))
    .map((chapter) => {
      const period = chapterPeriod(chapter, today);
      return {
        ...chapter,
        period,
        loggedDays: countDatesInRange(sortedLoggedDates, period.start, period.end),
        lengthDays: periodLengthDays(period),
      };
    })
    .filter((summary) => summary.loggedDays > 0);
}

async function fetchChapters(): Promise<RecapChapter[]> {
  const [occupations, residences, relationships] = await Promise.all([
    listProfileOccupations(),
    listProfileResidences(),
    listProfileRelationships(),
  ]);
  return buildChapters({ occupations, residences, relationships });
}

/** The published chapters, for the index on /recap. Reads every logged
 * date (a few thousand short strings) rather than one count query per
 * chapter — there are a few dozen chapters at most, and one round trip
 * beats thirty. */
export async function listRecapChapters(today: string = todayDateString()): Promise<RecapChapterSummary[]> {
  const db = getDb();
  const [chapters, dateRows] = await Promise.all([
    fetchChapters(),
    db.select({ date: days.date }).from(days).orderBy(asc(days.date)),
  ]);
  return summarizeChapters(
    chapters,
    dateRows.map((row) => row.date),
    today
  );
}

/** One chapter by its key, published or not — the page decides what to
 * show for an unpublished one. Null for a key that names no profile row. */
export async function getRecapChapter(key: string): Promise<RecapChapter | null> {
  if (!/^(occupation|role|residence|relationship)-\d+$/.test(key)) return null;
  const chapters = await fetchChapters();
  return chapters.find((chapter) => chapter.key === key) ?? null;
}

/** Index-card heading per kind, in the order the index lists them. */
export const CHAPTER_KIND_LABELS: Record<Exclude<RecapChapterKind, "role">, string> = {
  work: "Work",
  education: "Education",
  residence: "Homes",
  relationship: "Relationships",
};

/** "Aug 2018 – Dec 2022 · 4½ years", or "Since May 2026" while ongoing —
 * the line under a chapter's name on the index and its page. Month
 * precision, since that's how people date a job or a move. */
export function chapterSpanLabel(chapter: RecapChapter, today: string): string {
  const from = formatDate(chapter.start, "monthYear");
  if (chapter.end === null) return `Since ${from}`;
  const length = periodLengthDays(chapterPeriod(chapter, today));
  return `${from} – ${formatDate(chapter.end, "monthYear")} · ${describeSpan(length)}`;
}
