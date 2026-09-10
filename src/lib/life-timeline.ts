import type { TimelineInterval } from "@/lib/viz/timeline";

// Pure view-building for the life-timeline chart (#310 follow-up): which
// lane each entry belongs to under a given mode + grouping, and — for the
// role view — how an occupation's promotions become their own bars.
//
// Split from the DB fetch in charts.ts for the same reason timeline.ts is
// split from interactive-timeline.tsx: the interesting decisions here
// (role chaining, "not recorded" buckets, lane ordering) are worth testing
// without a database or a rendered chart.

/** A profile timeline entry with every dimension it can be grouped by
 * already resolved server-side. Nulls are real — a place may have no metro
 * assigned, an occupation may have no company recorded — and the view
 * builder buckets them rather than dropping the entry. */
export type LifeTimelineEntry = TimelineInterval & {
  color: string | null;
  kind: LifeTimelineKind;
  company: string | null;
  /** Where the entry's place sits in the place hierarchy. Resolved from
   * the place's ancestors by their own category/subcategory taxonomy, not
   * by path depth — depth varies (a UAE address has no state tier the way
   * a US one does). */
  country: string | null;
  state: string | null;
  municipality: string | null;
  neighborhood: string | null;
  /** Metro area, read off the entry's Municipality-level ancestor — the
   * only tier `places.metroId` is ever set on (see assertValidMetro in
   * src/lib/days.ts). This is what merges Arlington, Reston and Tysons
   * Corner into one "Washington DC" lane. */
  metro: string | null;
  /** Promotions/title changes within this entry, start-ascending. Only
   * occupations have these. */
  roles: LifeTimelineRole[];
};

export type LifeTimelineRole = { id: string; label: string; start: string; end: string | null };

export type LifeTimelineKind = "occupation" | "residence" | "relationship";

/** Which timeline(s) the chart is showing. "all" is the overview the chart
 * opens on; the other two are the focused modes, each with its own
 * groupings below. */
export type LifeTimelineMode = "all" | "occupation" | "residence";

export type OccupationGroupBy = "entry" | "role" | "company" | "metro";
export type ResidenceGroupBy = "entry" | "neighborhood" | "metro" | "state" | "country";
export type LifeTimelineGroupBy = OccupationGroupBy | ResidenceGroupBy;

/** Shown when an entry has nothing recorded for the dimension being
 * grouped on. A named bucket, not a dropped row: an occupation with no
 * company is still a job you had, and silently omitting it would make the
 * chart disagree with the overview mode for no visible reason. */
export const UNGROUPED_LANE = "Not recorded";

/** Lane names for "all" mode, in the order they appear on the y-axis. */
const KIND_LANES: Record<LifeTimelineKind, string> = {
  occupation: "Occupation",
  residence: "Residence",
  relationship: "Relationship",
};

/**
 * Expands one occupation into a bar per role.
 *
 * Roles in this app record a `start` and, in practice, no `end` — a
 * promotion is a point in time, and what ends it is the *next* promotion.
 * So a role runs until the next role begins, and the last role inherits
 * the occupation's own end (which may itself be null, i.e. still ongoing).
 * Taking each role's null `end` at face value would instead draw every
 * promotion as an open-ended bar running to today, stacked on top of each
 * other — four overlapping bars for one job.
 *
 * A role that *does* carry its own end is believed as-is; this only fills
 * in the ones that don't.
 */
export function chainRoles(entry: LifeTimelineEntry): TimelineInterval[] {
  const sorted = [...entry.roles].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return sorted.map((role, i) => {
    const next = sorted[i + 1];
    return {
      id: role.id,
      lane: entry.label,
      label: role.label,
      start: role.start,
      end: role.end ?? next?.start ?? entry.end,
    };
  });
}

function laneFor(entry: LifeTimelineEntry, groupBy: LifeTimelineGroupBy): string {
  switch (groupBy) {
    case "company":
      return entry.company ?? UNGROUPED_LANE;
    case "metro":
      return entry.metro ?? UNGROUPED_LANE;
    case "neighborhood":
      return entry.neighborhood ?? UNGROUPED_LANE;
    case "state":
      return entry.state ?? UNGROUPED_LANE;
    case "country":
      return entry.country ?? UNGROUPED_LANE;
    case "entry":
    case "role":
      // A focused mode's "Job"/"Home" grouping puts each entry on its own
      // row — that's the point of focusing on one timeline. Collapsing
      // them back into a single "Occupation" band would just reproduce the
      // overview mode's row.
      //
      // "role" lands here too. It's normally handled before this function
      // (it's the one grouping that changes what a *bar* is, not just its
      // lane), but an occupation with no roles recorded falls through to
      // the plain mapping — and it should still get its own row, exactly
      // as if it were grouped by job.
      return entry.label;
  }
}

/**
 * Turns the fetched entries into the intervals the chart draws, for one
 * mode + grouping.
 *
 * Lane order is the order lanes are first seen here, because that's what
 * `layoutTimeline` keys the y-axis off. Entries arrive start-ascending, so
 * grouped lanes come out in order of *when that lane first appears in your
 * life* — countries in the order you lived in them, companies in the order
 * you joined them. That reads far better than alphabetical for a timeline,
 * and needs no sorting to achieve; it's just a property of not re-sorting.
 *
 * `UNGROUPED_LANE` is the exception: it's forced last, since "Not
 * recorded" is a footnote rather than a step in the sequence.
 */
export function buildTimelineView(
  entries: LifeTimelineEntry[],
  options: { mode: LifeTimelineMode; groupBy: LifeTimelineGroupBy },
): TimelineInterval[] {
  const { mode, groupBy } = options;

  const inMode =
    mode === "all" ? entries : entries.filter((entry) => entry.kind === mode);

  // Role view is the one grouping that changes what a *bar* is, not just
  // which lane it sits in: one bar per promotion, laned by the job it
  // happened in. An occupation with no roles recorded still gets its own
  // bar, so a job never vanishes just because nobody logged a title for it.
  const intervals: TimelineInterval[] =
    mode === "occupation" && groupBy === "role"
      ? inMode.flatMap((entry) => {
          const roles = chainRoles(entry);
          return roles.length > 0
            ? roles
            : [{ id: entry.id, lane: entry.label, label: entry.label, start: entry.start, end: entry.end }];
        })
      : inMode.map((entry) => ({
          id: entry.id,
          // Overview mode always lanes by which timeline an entry belongs
          // to — that's what "all" means, and no grouping applies across
          // three different kinds of thing.
          lane: mode === "all" ? KIND_LANES[entry.kind] : laneFor(entry, groupBy),
          label: entry.label,
          start: entry.start,
          end: entry.end,
        }));

  const ungrouped = intervals.filter((i) => i.lane === UNGROUPED_LANE);
  return ungrouped.length === 0 ? intervals : [...intervals.filter((i) => i.lane !== UNGROUPED_LANE), ...ungrouped];
}

/** The groupings offered for each mode, in the order they're shown. */
export const GROUP_BY_OPTIONS: Record<LifeTimelineMode, { id: LifeTimelineGroupBy; label: string }[]> = {
  all: [],
  occupation: [
    { id: "entry", label: "Job" },
    { id: "role", label: "Role" },
    { id: "company", label: "Company" },
    { id: "metro", label: "Metro area" },
  ],
  residence: [
    { id: "entry", label: "Home" },
    { id: "neighborhood", label: "Neighborhood" },
    { id: "metro", label: "Metro area" },
    { id: "state", label: "State" },
    { id: "country", label: "Country" },
  ],
};
