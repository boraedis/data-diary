import type { RecapPeriod } from "@/lib/recap";
import {
  listProfileOccupations,
  listProfileRelationships,
  listProfileResidences,
  type ProfileOccupationItem,
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
export type RecapLifeEventKind = "occupation" | "residence" | "relationship" | "role";

/**
 * How an entry's date range sits against the period, which is what decides
 * the sentence the UI writes about it.
 *
 * Four cases, not three: an entry can begin *and* end inside the same
 * period (a short job, a stay somewhere for a season), and collapsing that
 * into "started" would quietly drop the fact that it also ended.
 */
export type RecapLifeEventFraming = "started" | "ended" | "started-and-ended" | "throughout";

export type RecapLifeEvent = {
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
  kind: RecapLifeEventKind,
  item: { name: string; alias: string | null; start: string; end: string | null; color: string | null },
  detail: string | null
): RecapLifeEvent | null {
  const framing = classifyOverlap(period, item.start, item.end);
  if (framing === null) return null;
  return {
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
  const [occupations, residences, relationships] = await Promise.all([
    listProfileOccupations(),
    listProfileResidences(),
    listProfileRelationships(),
  ]);

  const events: RecapLifeEvent[] = [];

  for (const occupation of occupations) {
    const event = toEvent(period, "occupation", occupation, occupationDetail(occupation));
    if (event) events.push(event);
    events.push(...roleEvents(period, occupation));
  }
  for (const residence of residences) {
    const event = toEvent(period, "residence", residence, residence.placeName);
    if (event) events.push(event);
  }
  for (const relationship of relationships) {
    const event = toEvent(period, "relationship", relationship, relationship.personName);
    if (event) events.push(event);
  }

  return events.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}
