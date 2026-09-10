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
  const DATA = [
    entry({ id: "occupation-1", label: "Co-op", kind: "occupation", company: "Delta", metro: "Atlanta" }),
    entry({ id: "occupation-2", label: "Consultant", kind: "occupation", company: "CapTech", metro: "Atlanta" }),
    entry({ id: "occupation-3", label: "Engineer", kind: "occupation", company: "Capital One", metro: "Washington DC" }),
    entry({ id: "residence-1", label: "Dorm", kind: "residence", neighborhood: "Georgia Tech", state: "Georgia", country: "USA", metro: "Atlanta" }),
    entry({ id: "residence-2", label: "Ballston", kind: "residence", neighborhood: "Ballston", state: "Virginia", country: "USA", metro: "Washington DC" }),
    entry({ id: "relationship-1", label: "Someone", kind: "relationship" }),
  ];

  it("lanes by timeline kind in overview mode", () => {
    const view = buildTimelineView(DATA, { mode: "all", groupBy: "entry" });
    expect([...new Set(view.map((i) => i.lane))]).toEqual(["Occupation", "Residence", "Relationship"]);
    expect(view).toHaveLength(6);
  });

  it("shows only the focused timeline in a focused mode", () => {
    const view = buildTimelineView(DATA, { mode: "residence", groupBy: "entry" });
    expect(view.map((i) => i.id)).toEqual(["residence-1", "residence-2"]);
  });

  it("gives each entry its own lane under the entry grouping", () => {
    // Rather than collapsing them back into one "Residence" band, which
    // would just reproduce the overview row.
    const view = buildTimelineView(DATA, { mode: "residence", groupBy: "entry" });
    expect(view.map((i) => i.lane)).toEqual(["Dorm", "Ballston"]);
  });

  it("merges entries that share a grouping value into one lane", () => {
    // The point of metro grouping: Arlington, Reston and Tysons Corner are
    // one place as far as "where did I live" is concerned.
    const view = buildTimelineView(DATA, { mode: "occupation", groupBy: "metro" });
    expect(view.map((i) => i.lane)).toEqual(["Atlanta", "Atlanta", "Washington DC"]);
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

  it("orders lanes by when each first appears, not alphabetically", () => {
    // layoutTimeline keys the y-axis off first appearance, and entries
    // arrive start-ascending — so lanes come out in the order they entered
    // your life, which is the right reading for a timeline.
    const view = buildTimelineView(DATA, { mode: "occupation", groupBy: "company" });
    expect(view.map((i) => i.lane)).toEqual(["Delta", "CapTech", "Capital One"]);
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
      entry({ id: "occupation-1", label: "Unknown", company: null }),
      entry({ id: "occupation-2", label: "Known", company: "Delta" }),
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
