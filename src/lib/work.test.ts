import { describe, expect, it } from "vitest";
import { commuteCategories, groupHappiness, workMeasureValue, type WorkDay } from "@/lib/work";

// The Work charts' shaping rules (#444): what a day contributes under each
// measure, and which Work vs. Happiness row it lands in.

const day = (overrides: Partial<WorkDay> = {}): WorkDay => ({
  date: "2026-06-01",
  minutes: null,
  productivity: null,
  locations: [],
  commute: [],
  dayType: null,
  happiness: null,
  ...overrides,
});

describe("workMeasureValue", () => {
  it("converts minutes to hours", () => {
    expect(workMeasureValue(day({ minutes: 450 }), "hours")).toBe(7.5);
  });

  it("multiplies hours by productivity for productive hours", () => {
    expect(workMeasureValue(day({ minutes: 480, productivity: 50 }), "productiveHours")).toBe(4);
  });

  it("excludes a day missing what the measure needs rather than scoring it 0", () => {
    expect(workMeasureValue(day({ productivity: 70 }), "hours")).toBeUndefined();
    expect(workMeasureValue(day({ minutes: 480 }), "productivity")).toBeUndefined();
    // No productivity logged is not 100% (or 0%) productive.
    expect(workMeasureValue(day({ minutes: 480 }), "productiveHours")).toBeUndefined();
  });

  it("keeps a real 0 as 0", () => {
    expect(workMeasureValue(day({ minutes: 0 }), "hours")).toBe(0);
    expect(workMeasureValue(day({ productivity: 0 }), "productivity")).toBe(0);
  });
});

describe("commuteCategories", () => {
  it("passes a logged commute through", () => {
    expect(commuteCategories(day({ locations: ["office"], commute: ["public_transit"] }))).toEqual(["public_transit"]);
  });

  it("reads a location with no commute as no commute", () => {
    expect(commuteCategories(day({ locations: ["home"] }))).toEqual(["none"]);
  });

  it("treats a day with neither as untracked", () => {
    expect(commuteCategories(day())).toEqual([]);
  });
});

describe("groupHappiness", () => {
  it("bands hours with the lower edge inclusive", () => {
    const groups = groupHappiness(
      [
        day({ date: "2026-06-01", minutes: 8 * 60, happiness: 80 }),
        day({ date: "2026-06-02", minutes: 8 * 60 - 1, happiness: 70 }),
        day({ date: "2026-06-03", minutes: 3 * 60, happiness: 60 }),
      ],
      "hours",
    );
    expect(groups.map((g) => [g.label, g.values.map((v) => v.value)])).toEqual([
      ["Under 4h", [60]],
      ["6–8h", [70]],
      ["8–10h", [80]],
    ]);
  });

  it("drops days without happiness or without what the grouping needs", () => {
    const groups = groupHappiness(
      [day({ minutes: 480 }), day({ happiness: 90 }), day({ minutes: 480, happiness: 75 })],
      "hours",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].values).toEqual([{ date: "2026-06-01", value: 75 }]);
  });

  it("groups a split location day as its own combination, singles first", () => {
    const groups = groupHappiness(
      [
        day({ locations: ["office", "home"], happiness: 80 }),
        day({ locations: ["office"], happiness: 70 }),
        day({ locations: ["home"], happiness: 90 }),
      ],
      "location",
    );
    expect(groups.map((g) => g.label)).toEqual(["Home", "Office", "Home + Office"]);
  });

  it("orders day types by the fixed order, not by first appearance", () => {
    const groups = groupHappiness(
      [day({ dayType: "vacation", happiness: 95 }), day({ dayType: "work", happiness: 80 })],
      "dayType",
    );
    expect(groups.map((g) => g.id)).toEqual(["work", "vacation"]);
  });
});
