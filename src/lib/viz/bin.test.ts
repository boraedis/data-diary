import { describe, expect, it } from "vitest";
import { groupByPeriod, summarizePeriods } from "@/lib/viz/bin";

type Item = { date: string; value: number };

function item(date: string, value: number): Item {
  return { date, value };
}

describe("groupByPeriod", () => {
  it("buckets by week, keyed by the ISO Monday", () => {
    // 2026-02-14 is a Saturday in the week starting Mon 2026-02-09
    const items = [item("2026-02-09", 1), item("2026-02-14", 2), item("2026-02-16", 3)];
    const buckets = groupByPeriod(items, "week", (i) => i.date);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ key: "2026-02-09", start: "2026-02-09" });
    expect(buckets[0].items).toHaveLength(2);
    expect(buckets[1]).toMatchObject({ key: "2026-02-16", start: "2026-02-16" });
  });

  it("treats Sunday as the last day of its week, not the first", () => {
    // Sunday 2026-02-15 belongs to the week starting Mon 2026-02-09
    const buckets = groupByPeriod([item("2026-02-15", 1)], "week", (i) => i.date);
    expect(buckets[0].key).toBe("2026-02-09");
  });

  it("buckets by month using 'YYYY-MM' keys", () => {
    const items = [item("2026-02-01", 1), item("2026-02-28", 2), item("2026-03-01", 3)];
    const buckets = groupByPeriod(items, "month", (i) => i.date);
    expect(buckets.map((b) => b.key)).toEqual(["2026-02", "2026-03"]);
    expect(buckets[0].start).toBe("2026-02-01");
  });

  it("buckets by quarter", () => {
    const items = [item("2026-01-15", 1), item("2026-04-01", 2), item("2026-12-31", 3)];
    const buckets = groupByPeriod(items, "quarter", (i) => i.date);
    expect(buckets.map((b) => b.key)).toEqual(["2026-Q1", "2026-Q2", "2026-Q4"]);
    expect(buckets[1].start).toBe("2026-04-01");
  });

  it("buckets by year", () => {
    const items = [item("2025-06-01", 1), item("2026-01-01", 2)];
    const buckets = groupByPeriod(items, "year", (i) => i.date);
    expect(buckets.map((b) => b.key)).toEqual(["2025", "2026"]);
  });

  it("sorts buckets oldest-first regardless of input order", () => {
    const items = [item("2026-03-01", 1), item("2026-01-01", 2), item("2026-02-01", 3)];
    const buckets = groupByPeriod(items, "month", (i) => i.date);
    expect(buckets.map((b) => b.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupByPeriod([], "month", (i: Item) => i.date)).toEqual([]);
  });
});

describe("summarizePeriods", () => {
  it("computes average and count per bucket", () => {
    const buckets = groupByPeriod(
      [item("2026-02-01", 10), item("2026-02-05", 20), item("2026-03-01", 30)],
      "month",
      (i) => i.date
    );
    const summaries = summarizePeriods(buckets, (i) => i.value);
    expect(summaries).toEqual([
      { key: "2026-02", start: "2026-02-01", avg: 15, count: 2 },
      { key: "2026-03", start: "2026-03-01", avg: 30, count: 1 },
    ]);
  });
});
