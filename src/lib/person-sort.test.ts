import { describe, expect, it, vi } from "vitest";
import { comparePeopleByRecencyAndMentions } from "@/lib/person-sort";
import * as dateLib from "@/lib/date";

const TODAY = "2026-03-01";

function withFixedToday<T>(fn: () => T): T {
  const spy = vi.spyOn(dateLib, "todayDateString").mockReturnValue(TODAY);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

describe("comparePeopleByRecencyAndMentions", () => {
  it("ranks higher total-count people above lower ones when neither was mentioned recently", () => {
    withFixedToday(() => {
      const stats = new Map([
        [1, { totalCount: 10, mostRecentDate: null }],
        [2, { totalCount: 3, mostRecentDate: null }],
      ]);
      const sorted = [
        { id: 2, name: "Bob" },
        { id: 1, name: "Alice" },
      ].sort(comparePeopleByRecencyAndMentions(stats));
      expect(sorted.map((p) => p.id)).toEqual([1, 2]);
    });
  });

  it("lets a recent single mention outrank a much higher but stale total count", () => {
    withFixedToday(() => {
      const stats = new Map([
        [1, { totalCount: 50, mostRecentDate: "2020-01-01" }], // stale, no recency boost left
        [2, { totalCount: 1, mostRecentDate: TODAY }], // mentioned today, full boost
      ]);
      const sorted = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ].sort(comparePeopleByRecencyAndMentions(stats));
      expect(sorted.map((p) => p.id)).toEqual([2, 1]);
    });
  });

  it("treats a person with no stats entry as score 0", () => {
    withFixedToday(() => {
      const stats = new Map([[1, { totalCount: 5, mostRecentDate: null }]]);
      const sorted = [
        { id: 2, name: "NoStats" },
        { id: 1, name: "HasStats" },
      ].sort(comparePeopleByRecencyAndMentions(stats));
      expect(sorted.map((p) => p.id)).toEqual([1, 2]);
    });
  });

  it("breaks ties by name when scores are equal", () => {
    withFixedToday(() => {
      const stats = new Map<number, { totalCount: number; mostRecentDate: string | null }>();
      const sorted = [
        { id: 2, name: "Zeta" },
        { id: 1, name: "Alpha" },
      ].sort(comparePeopleByRecencyAndMentions(stats));
      expect(sorted.map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
    });
  });
});
