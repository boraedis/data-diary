import { describe, expect, it } from "vitest";
import { daySplitSide, splitDays, UNPLACED_GROUP_ID, type SplittableDay } from "@/lib/day-split";

// 2026-09-19 is a Saturday, 2026-09-21 a Monday.
const SAT = "2026-09-19";
const SUN = "2026-09-20";
const MON = "2026-09-21";
const FRI = "2026-09-25";

describe("daySplitSide", () => {
  it("splits work days from every other recorded day type", () => {
    expect(daySplitSide({ date: MON, dayType: "work" }, "work")).toBe("work");
    for (const t of ["dayoff", "vacation", "travel", "jobless", "sick"] as const) {
      expect(daySplitSide({ date: MON, dayType: t }, "work")).toBe("off");
    }
  });

  it("leaves a day with no type out of the work split", () => {
    expect(daySplitSide({ date: MON, dayType: null }, "work")).toBeNull();
  });

  it("splits Saturday and Sunday from Monday–Friday by the calendar alone", () => {
    expect(daySplitSide({ date: SAT, dayType: null }, "weekend")).toBe("weekend");
    expect(daySplitSide({ date: SUN, dayType: "work" }, "weekend")).toBe("weekend");
    expect(daySplitSide({ date: MON, dayType: null }, "weekend")).toBe("weekday");
    expect(daySplitSide({ date: FRI, dayType: "dayoff" }, "weekend")).toBe("weekday");
  });
});

describe("splitDays", () => {
  const days: SplittableDay[] = [
    { date: MON, dayType: "work" },
    { date: SAT, dayType: "dayoff" },
    { date: SUN, dayType: null },
  ];

  it("returns both sides in fixed order, dropping days it can't place", () => {
    const groups = splitDays(days, "work");
    expect(groups.map((g) => [g.id, g.days.length])).toEqual([
      ["work", 1],
      ["off", 1],
    ]);
  });

  it("keeps an empty side so its color and legend slot don't move", () => {
    const groups = splitDays([{ date: MON, dayType: "work" }], "work");
    expect(groups.map((g) => g.id)).toEqual(["work", "off"]);
    expect(groups[1].days).toEqual([]);
  });

  it("returns every day as one group for none", () => {
    expect(splitDays(days, "none")).toEqual([{ id: "all", label: "All days", days }]);
  });

  it("returns the days it can't place as a third group when asked, so the groups add back up", () => {
    const groups = splitDays(days, "work", { includeUnplaced: true });
    expect(groups.map((g) => [g.id, g.days.length])).toEqual([
      ["work", 1],
      ["off", 1],
      [UNPLACED_GROUP_ID, 1],
    ]);
    expect(groups.reduce((n, g) => n + g.days.length, 0)).toBe(days.length);
  });

  it("adds no empty third group when every day is placed", () => {
    expect(splitDays(days, "weekend", { includeUnplaced: true }).map((g) => g.id)).toEqual(["weekday", "weekend"]);
  });
});
