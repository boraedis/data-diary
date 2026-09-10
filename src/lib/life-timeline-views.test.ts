import { describe, expect, it } from "vitest";
import {
  buildTimelineView,
  chainRoles,
  UNGROUPED_LANE,
  type LifeTimelineEntry,
  type LifeTimelineKind,
} from "@/lib/life-timeline";

// The mode/grouping logic, which is where the follow-up's real decisions
// live: role chaining, "not recorded" buckets, and lane ordering. Pure, so
// none of it needs a database or a rendered chart.

function entry(over: Partial<LifeTimelineEntry> & { id: string }): LifeTimelineEntry {
  return {
    lane: "Occupation",
    label: over.id,
    start: "2020-01-01",
    end: null,
    color: null,
    kind: "occupation" as LifeTimelineKind,
    company: null,
    country: null,
    state: null,
    municipality: null,
    neighborhood: null,
    metro: null,
    roles: [],
    ...over,
  };
}

describe("chainRoles", () => {
  it("ends each role where the next one starts", () => {
    // Roles record a start and, in practice, no end — the thing that ends
    // a promotion is the next promotion. Believing the nulls would draw
    // three overlapping open-ended bars for one job.
    const chained = chainRoles(
      entry({
        id: "occupation-1",
        start: "2023-01-01",
        end: "2026-01-01",
        roles: [
          { id: "role-1", label: "Associate", start: "2023-01-01", end: null },
          { id: "role-2", label: "Consultant", start: "2024-01-01", end: null },
          { id: "role-3", label: "Senior", start: "2025-01-01", end: null },
        ],
      }),
    );
    expect(chained.map((r) => [r.label, r.start, r.end])).toEqual([
      ["Associate", "2023-01-01", "2024-01-01"],
      ["Consultant", "2024-01-01", "2025-01-01"],
      ["Senior", "2025-01-01", "2026-01-01"],
    ]);
  });

  it("gives the last role the occupation's own open end, so it reads as ongoing", () => {
    const chained = chainRoles(
      entry({
        id: "occupation-1",
        start: "2023-01-01",
        end: null,
        roles: [{ id: "role-1", label: "Engineer", start: "2023-01-01", end: null }],
      }),
    );
    expect(chained[0].end).toBeNull();
  });

  it("believes a role that carries its own end", () => {
    const chained = chainRoles(
      entry({
        id: "occupation-1",
        start: "2023-01-01",
        end: "2026-01-01",
        roles: [
          { id: "role-1", label: "Associate", start: "2023-01-01", end: "2023-06-01" },
          { id: "role-2", label: "Consultant", start: "2024-01-01", end: null },
        ],
      }),
    );
    // Not stretched to the next role's start — a recorded gap is real.
    expect(chained[0].end).toBe("2023-06-01");
  });

  it("chains in date order even when the roles arrive out of order", () => {
    const chained = chainRoles(
      entry({
        id: "occupation-1",
        start: "2023-01-01",
        end: "2026-01-01",
        roles: [
          { id: "role-2", label: "Consultant", start: "2024-01-01", end: null },
          { id: "role-1", label: "Associate", start: "2023-01-01", end: null },
        ],
      }),
    );
    expect(chained.map((r) => r.label)).toEqual(["Associate", "Consultant"]);
    expect(chained[0].end).toBe("2024-01-01");
  });
});

describe("buildTimelineView", () => {
  // Deliberately newest-first, because that is exactly how the data
  // arrives: every list function in src/lib/profile.ts `reverse()`s for the
  // admin UI. Ordering assertions below are meaningless against a fixture
  // that is already sorted the way the answer should come out.
  const DATA = [
    entry({ id: "occupation-3", label: "Engineer", kind: "occupation", company: "Capital One", metro: "Washington DC", start: "2024-01-01" }),
    entry({ id: "occupation-2", label: "Consultant", kind: "occupation", company: "CapTech", metro: "Atlanta", start: "2022-01-01" }),
    entry({ id: "occupation-1", label: "Co-op", kind: "occupation", company: "Delta", metro: "Atlanta", start: "2020-01-01" }),
    entry({ id: "residence-2", label: "Ballston", kind: "residence", neighborhood: "Ballston", state: "Virginia", country: "USA", metro: "Washington DC", start: "2024-01-01" }),
    entry({ id: "residence-1", label: "Dorm", kind: "residence", neighborhood: "Georgia Tech", state: "Georgia", country: "USA", metro: "Atlanta", start: "2020-01-01" }),
    entry({ id: "relationship-1", label: "Someone", kind: "relationship", start: "2021-01-01" }),
  ];

  it("lanes by timeline kind in overview mode", () => {
    const view = buildTimelineView(DATA, { mode: "all", groupBy: "entry" });
    expect([...new Set(view.map((i) => i.lane))]).toEqual(["Occupation", "Residence", "Relationship"]);
    expect(view).toHaveLength(6);
  });

  it("shows only the focused timeline in a focused mode", () => {
    const view = buildTimelineView(DATA, { mode: "residence", groupBy: "entry" });
    expect(new Set(view.map((i) => i.id))).toEqual(new Set(["residence-1", "residence-2"]));
  });

  it("gives each entry its own lane under the entry grouping", () => {
    // Rather than collapsing them back into one "Residence" band, which
    // would just reproduce the overview row.
    const view = buildTimelineView(DATA, { mode: "residence", groupBy: "entry" });
    expect(view.map((i) => i.lane)).toEqual(["Dorm", "Ballston"]);
  });

  it("puts the oldest lane at the top of a focused mode, whatever order the data arrives in", () => {
    // Reading down the chart should read forwards through time, matching
    // the axis. The data arrives newest-first (see DATA above), so this
    // only holds because the ordering is imposed rather than inherited —
    // before the fix every drill-down rendered upside down.
    expect(buildTimelineView(DATA, { mode: "residence", groupBy: "entry" }).map((i) => i.lane)).toEqual([
      "Dorm",
      "Ballston",
    ]);
    expect(buildTimelineView(DATA, { mode: "occupation", groupBy: "company" }).map((i) => i.lane)).toEqual([
      "Delta",
      "CapTech",
      "Capital One",
    ]);
  });

  it("ranks a merged lane by its earliest entry, not its latest", () => {
    // Atlanta's first job predates Washington DC's, so Atlanta leads even
    // though it also holds a later entry.
    const view = buildTimelineView(DATA, { mode: "occupation", groupBy: "metro" });
    expect(view.map((i) => i.lane)).toEqual(["Atlanta", "Atlanta", "Washington DC"]);
  });

  it("merges entries that share a grouping value into one lane", () => {
    // The point of metro grouping: Arlington, Reston and Tysons Corner are
    // one place as far as "where did I live" is concerned.
    const view = buildTimelineView(DATA, { mode: "occupation", groupBy: "metro" });
    expect(view.filter((i) => i.lane === "Atlanta")).toHaveLength(2);
    expect(view.filter((i) => i.lane === "Washington DC")).toHaveLength(1);
  });

  it("groups occupations by company", () => {
    const view = buildTimelineView(DATA, { mode: "occupation", groupBy: "company" });
    expect(view.map((i) => i.lane)).toEqual(["Delta", "CapTech", "Capital One"]);
  });

  it.each([
    ["neighborhood", ["Georgia Tech", "Ballston"]],
    ["state", ["Georgia", "Virginia"]],
    ["country", ["USA", "USA"]],
  ] as const)("groups residences by %s", (groupBy, expected) => {
    const view = buildTimelineView(DATA, { mode: "residence", groupBy });
    expect(view.map((i) => i.lane)).toEqual(expected);
  });

  it("orders lanes chronologically, not alphabetically", () => {
    // Alphabetical would put Capital One first; chronological is the right
    // reading for a timeline.
    const view = buildTimelineView(DATA, { mode: "occupation", groupBy: "company" });
    expect(view.map((i) => i.lane)).toEqual(["Delta", "CapTech", "Capital One"]);
  });

  it("keeps overview mode's three lanes in kind order, not chronological order", () => {
    // Residence and occupation both start in 2020 here and the
    // relationship starts later, but the overview's grouping is about kind
    // rather than chronology, so the order is fixed.
    const view = buildTimelineView(DATA, { mode: "all", groupBy: "entry" });
    expect([...new Set(view.map((i) => i.lane))]).toEqual(["Occupation", "Residence", "Relationship"]);
  });

  it("buckets entries with nothing recorded for the grouping, rather than dropping them", () => {
    const data = [
      entry({ id: "occupation-1", label: "Known", company: "Delta" }),
      entry({ id: "occupation-2", label: "Unknown", company: null }),
    ];
    const view = buildTimelineView(data, { mode: "occupation", groupBy: "company" });
    expect(view).toHaveLength(2);
    expect(view.map((i) => i.lane)).toEqual(["Delta", UNGROUPED_LANE]);
  });

  it("forces the not-recorded lane last, however early its entries start", () => {
    const data = [
      entry({ id: "occupation-1", label: "Unknown", company: null, start: "2001-01-01" }),
      entry({ id: "occupation-2", label: "Known", company: "Delta", start: "2020-01-01" }),
    ];
    const view = buildTimelineView(data, { mode: "occupation", groupBy: "company" });
    expect(view.map((i) => i.lane)).toEqual(["Delta", UNGROUPED_LANE]);
  });

  it("turns each role into its own bar, laned by the job it happened in", () => {
    const data = [
      entry({
        id: "occupation-1",
        label: "CapTech",
        start: "2023-01-01",
        end: "2025-01-01",
        roles: [
          { id: "role-1", label: "Associate", start: "2023-01-01", end: null },
          { id: "role-2", label: "Consultant", start: "2024-01-01", end: null },
        ],
      }),
    ];
    const view = buildTimelineView(data, { mode: "occupation", groupBy: "role" });
    expect(view.map((i) => [i.lane, i.label])).toEqual([
      ["CapTech", "Associate"],
      ["CapTech", "Consultant"],
    ]);
  });

  it("keeps a job with no roles recorded visible in the role view", () => {
    // Otherwise a job silently vanishes from the chart just because nobody
    // logged a title for it.
    const data = [entry({ id: "occupation-1", label: "Untitled job", roles: [] })];
    const view = buildTimelineView(data, { mode: "occupation", groupBy: "role" });
    expect(view.map((i) => [i.lane, i.label])).toEqual([["Untitled job", "Untitled job"]]);
  });

  it("never lets the role view produce duplicate ids", () => {
    // Ids key the chart's marks; a collision would drop bars.
    const data = [
      entry({
        id: "occupation-1",
        label: "A",
        roles: [
          { id: "role-1", label: "One", start: "2023-01-01", end: null },
          { id: "role-2", label: "Two", start: "2024-01-01", end: null },
        ],
      }),
      entry({ id: "occupation-2", label: "B", roles: [] }),
    ];
    const ids = buildTimelineView(data, { mode: "occupation", groupBy: "role" }).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns nothing for a mode with no entries", () => {
    expect(buildTimelineView([], { mode: "occupation", groupBy: "entry" })).toEqual([]);
  });
});
