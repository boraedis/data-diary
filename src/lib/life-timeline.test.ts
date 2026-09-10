import { beforeEach, describe, expect, it, vi } from "vitest";

// `getLifeTimelineData` is a pure mapper over src/lib/profile.ts's three
// list functions, so this mocks that module rather than the database — the
// mapping decisions are the thing worth locking (id prefixing, alias
// preference, keeping `end: null` intact, lane order), and none of them
// need a real query to exercise.
//
// Kept out of charts.test.ts on purpose: that file's header records a
// deliberate choice to test only pure logic there and verify DB-backed
// fetchers live, and a hoisted vi.mock would apply to the whole file.

const listProfileOccupations = vi.fn();
const listProfileResidences = vi.fn();
const listProfileRelationships = vi.fn();

vi.mock("@/lib/profile", () => ({
  listProfileOccupations: () => listProfileOccupations(),
  listProfileResidences: () => listProfileResidences(),
  listProfileRelationships: () => listProfileRelationships(),
  getProfileSettings: () => Promise.resolve({}),
}));

const { getLifeTimelineData } = await import("@/lib/charts");

function entry(over: Partial<Record<string, unknown>> = {}) {
  return { id: 1, name: "Name", alias: null, start: "2020-01-01", end: null, color: null, ...over };
}

beforeEach(() => {
  listProfileOccupations.mockResolvedValue([]);
  listProfileResidences.mockResolvedValue([]);
  listProfileRelationships.mockResolvedValue([]);
});

describe("getLifeTimelineData", () => {
  it("emits lanes in occupation, residence, relationship order", async () => {
    // Lane order on the y-axis comes from first appearance in this array,
    // so the order here is load-bearing, not cosmetic.
    listProfileOccupations.mockResolvedValue([entry()]);
    listProfileResidences.mockResolvedValue([entry()]);
    listProfileRelationships.mockResolvedValue([entry()]);

    const items = await getLifeTimelineData();
    expect(items.map((i) => i.lane)).toEqual(["Occupation", "Residence", "Relationship"]);
  });

  it("prefixes ids per lane so the three tables' serial keys can't collide", async () => {
    // All three tables independently start at id 1.
    listProfileOccupations.mockResolvedValue([entry({ id: 1 })]);
    listProfileResidences.mockResolvedValue([entry({ id: 1 })]);
    listProfileRelationships.mockResolvedValue([entry({ id: 1 })]);

    const ids = (await getLifeTimelineData()).map((i) => i.id);
    expect(ids).toEqual(["occupation-1", "residence-1", "relationship-1"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("prefers alias over name as the label", async () => {
    listProfileOccupations.mockResolvedValue([entry({ name: "A Very Long Company Name", alias: "ACME" })]);
    expect((await getLifeTimelineData())[0].label).toBe("ACME");
  });

  it("falls back to name when there's no alias", async () => {
    listProfileOccupations.mockResolvedValue([entry({ name: "Acme Corp", alias: null })]);
    expect((await getLifeTimelineData())[0].label).toBe("Acme Corp");
  });

  it("keeps an open-ended entry open instead of resolving it to today", async () => {
    // The difference from getProfileRegionGroups, which resolves `end` to
    // `until` because a background band needs a right edge. Collapsing it
    // here would make an ongoing job render as one that ended today.
    listProfileResidences.mockResolvedValue([entry({ end: null })]);
    expect((await getLifeTimelineData())[0].end).toBeNull();
  });

  it("passes a real end date through untouched", async () => {
    listProfileResidences.mockResolvedValue([entry({ end: "2022-05-01" })]);
    expect((await getLifeTimelineData())[0].end).toBe("2022-05-01");
  });

  it("carries each entry's own colour, and null when none was set", async () => {
    listProfileOccupations.mockResolvedValue([entry({ id: 1, color: "#ff0000" }), entry({ id: 2, color: null })]);
    const items = await getLifeTimelineData();
    expect(items.map((i) => i.color)).toEqual(["#ff0000", null]);
  });

  it("returns nothing when no profile timelines are recorded", async () => {
    expect(await getLifeTimelineData()).toEqual([]);
  });

  it("omits a lane entirely when that timeline is empty, rather than emitting an empty band", async () => {
    listProfileResidences.mockResolvedValue([entry()]);
    const items = await getLifeTimelineData();
    expect(items.map((i) => i.lane)).toEqual(["Residence"]);
  });
});
