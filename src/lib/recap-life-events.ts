import type { RecapPeriod } from "@/lib/recap";
import {
  listProfileOccupations,
  listProfileRelationships,
  listProfileResidences,
  type ProfileOccupationItem,
  type ProfileRelationshipItem,
  type ProfileResidenceItem,
} from "@/lib/profile";

// The recap's life-events section (issue #173, epic #130).
//
// #130 calls these the "free" moments, and the distinction is worth
// keeping in mind: everything here is a structural date-range overlap
// against dates that were entered by hand as facts. There's no inference,
// no scoring, and no threshold to tune — unlike the data-derived moments
// engine (#174), which has to decide what counts as a spike. If a job
// started in the period, it started in the period.
//
// Naming convention for this epic: one `recap-<domain>.ts` module per card
// domain, all built on `src/lib/recap.ts`'s period contract. The remaining
// domain sub-issues (#170-#172) should follow it rather than growing a
// single recap god-module the way `charts.ts` did.

/** Which table an event came from. `role` is a position change inside an
 * occupation, not a separate job. */
export type RecapLifeEventKind = "occupation" | "education" | "residence" | "relationship" | "role";

/**
 * How an entry's date range sits against the period, which is what decides
 * the sentence the UI writes about it.
 *
 * Four cases, not three: an entry can begin *and* end inside the same
 * period (a short job, a stay somewhere for a season), and collapsing that
 * into "started" would quietly drop the fact that it also ended.
 */
export type RecapLifeEventFraming = "started" | "ended" | "started-and-ended" | "throughout";

/** Which profile table a row lives in, for `lifeEntryKey`. Education is an
 * occupation row, so it has no table of its own here. */
export type LifeEntryTable = "occupation" | "role" | "residence" | "relationship";

/**
 * A profile row's identity across the recap: "occupation-7", "role-12".
 *
 * One format shared by life events and chapters (#519), because a chapter's
 * report has to recognise its own entry in the life-events list in order to
 * leave it out — "Started Acme" inside the recap of Acme is the chapter
 * describing itself. It doubles as the chapter's route segment, so it's
 * URL-safe and stable for as long as the row exists.
 */
export function lifeEntryKey(table: LifeEntryTable, id: number): string {
  return `${table}-${id}`;
}

export type RecapLifeEvent = {
  /** `lifeEntryKey` of the row this event came from. */
  key: string;
  kind: RecapLifeEventKind;
  framing: RecapLifeEventFraming;
  /** The entry's `alias` when it has one, else its full name — same
   * shorter-label-wins rule `getProfileRegionGroups` uses for chart
   * labels. */
  title: string;
  /** Supporting line: where, with whom, as what. Null when the title
   * already says everything the entry knows. */
  detail: string | null;
  start: string;
  end: string | null;
  /** The date this event is filed under in a chronological list — its
   * start, except for an entry that only *ended* in the period. Entries
   * that span the whole period sort to the top, since they were already
   * true on day one. */
  sortDate: string;
  /** The entry's own color from the profile admin UI, carried through the
   * same way the scroller regions do. */
  color: string | null;
};

/**
 * Where an entry's range sits relative to the period, or null when the two
 * don't overlap at all.
 *
 * A null `end` means ongoing — it has to be treated as "extends past the
 * period", never as an unset value that fails a comparison. That's the one
 * thing this function exists to get right in a single place.
 */
export function classifyOverlap(
  period: RecapPeriod,
  start: string,
  end: string | null
): RecapLifeEventFraming | null {
  if (start > period.end) return null;
  if (end !== null && end < period.start) return null;

  const startsInside = start >= period.start;
  const endsInside = end !== null && end <= period.end;

  if (startsInside && endsInside) return "started-and-ended";
  if (startsInside) return "started";
  if (endsInside) return "ended";
  return "throughout";
}

function sortDateFor(
  period: RecapPeriod,
  framing: RecapLifeEventFraming,
  start: string,
  end: string | null
): string {
  if (framing === "throughout") return period.start;
  if (framing === "ended") return end as string;
  return start;
}

function toEvent(
  period: RecapPeriod,
  key: string,
  kind: RecapLifeEventKind,
  item: { name: string; alias: string | null; start: string; end: string | null; color: string | null },
  detail: string | null
): RecapLifeEvent | null {
  const framing = classifyOverlap(period, item.start, item.end);
  if (framing === null) return null;
  return {
    key,
    kind,
    framing,
    title: item.alias ?? item.name,
    detail,
    start: item.start,
    end: item.end,
    sortDate: sortDateFor(period, framing, item.start, item.end),
    color: item.color,
  };
}

/**
 * Position changes within a job, as their own events.
 *
 * Only roles that *started* inside the period count. A role that merely
 * overlaps it isn't news — it's the same job description it was in
 * January — and a role ending is almost always the next role starting,
 * which would report every promotion twice.
 *
 * The role that shares the occupation's own start date is skipped: that's
 * the job beginning, which is already reported as an occupation event.
 */
function roleEvents(period: RecapPeriod, occupation: ProfileOccupationItem): RecapLifeEvent[] {
  return occupation.roles
    .filter(
      (role) =>
        role.start >= period.start && role.start <= period.end && role.start !== occupation.start
    )
    .map((role) => ({
      key: lifeEntryKey("role", role.id),
      kind: "role" as const,
      framing: "started" as const,
      title: role.position,
      detail: occupation.alias ?? occupation.name,
      start: role.start,
      end: role.end,
      sortDate: role.start,
      color: occupation.color,
    }));
}

function occupationDetail(occupation: ProfileOccupationItem): string | null {
  // `name` is often already the company, so a "position at company" line
  // that repeats it reads badly; prefer the position, and fall back to the
  // place the job was based in.
  return occupation.position ?? occupation.company ?? occupation.placeName;
}

/**
 * Every job, home and relationship that overlapped the period, plus any
 * role change inside it, in chronological order.
 *
 * Reuses `src/lib/profile.ts`'s list functions rather than issuing three
 * more range-filtered queries, following `getProfileRegionGroups`'s
 * precedent in `charts.ts`: these tables hold a handful of rows each — a
 * lifetime of jobs and homes — so the overlap filter is cheaper and far
 * easier to test as pure logic than as SQL.
 *
 * Ships as a list card. #119's `InteractiveTimeline` is the natural
 * upgrade for this section once it exists (#130 flags this as its first
 * real consumer, and deliberately doesn't block on it) — the returned
 * shape is already interval-based, so that swap is a rendering change
 * rather than a re-query.
 */
export async function listRecapLifeEvents(period: RecapPeriod): Promise<RecapLifeEvent[]> {
  return buildRecapLifeEvents(await loadLifeEventSources(), period);
}

/** The three profile lists life events are built from. */
export type LifeEventSources = {
  occupations: ProfileOccupationItem[];
  residences: ProfileResidenceItem[];
  relationships: ProfileRelationshipItem[];
};

/** Split from `listRecapLifeEvents` so "on this day" (#522) can load the
 * lists once and ask about ten single-day periods, instead of re-reading
 * them per past year. */
export async function loadLifeEventSources(): Promise<LifeEventSources> {
  const [occupations, residences, relationships] = await Promise.all([
    listProfileOccupations(),
    listProfileResidences(),
    listProfileRelationships(),
  ]);
  return { occupations, residences, relationships };
}

/** The pure half of `listRecapLifeEvents`. */
export function buildRecapLifeEvents(
  { occupations, residences, relationships }: LifeEventSources,
  period: RecapPeriod
): RecapLifeEvent[] {
  const events: RecapLifeEvent[] = [];

  for (const occupation of occupations) {
    // School is its own kind so the card can say "Graduated" rather than
    // "Left" (#560); its role changes (a degree programme, say) stay roles.
    const event = toEvent(
      period,
      lifeEntryKey("occupation", occupation.id),
      occupation.type === "education" ? "education" : "occupation",
      occupation,
      occupationDetail(occupation)
    );
    if (event) events.push(event);
    events.push(...roleEvents(period, occupation));
  }
  for (const residence of residences) {
    const key = lifeEntryKey("residence", residence.id);
    const event = toEvent(period, key, "residence", residence, residence.placeName);
    if (event) events.push(event);
  }
  for (const relationship of relationships) {
    const key = lifeEntryKey("relationship", relationship.id);
    const event = toEvent(period, key, "relationship", relationship, relationship.personName);
    if (event) events.push(event);
  }

  return events.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}
