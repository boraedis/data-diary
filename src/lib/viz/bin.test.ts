import { describe, expect, it } from "vitest";
import {
  cycleOccurrenceKey,
  cyclePosition,
  cycleReferenceDate,
  foldByCycle,
  formatCyclePosition,
  groupByPeriod,
  poolCircularWindow,
  summarizePeriods,
} from "@/lib/viz/bin";

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

describe("cyclical folding", () => {
  it("places weekdays Monday-first on consecutive reference days", () => {
    expect(cyclePosition("weekday", "2026-09-28")).toBe(0); // a Monday
    expect(cyclePosition("weekday", "2026-10-04")).toBe(6); // a Sunday
    expect(cycleReferenceDate("weekday", 0)).toBe("2000-01-03");
    expect(cycleReferenceDate("weekday", 6)).toBe("2000-01-09");
    expect(cyclePosition("weekday", cycleReferenceDate("weekday", 4))).toBe(4);
  });

  it("keeps March 1st on the same day-of-year slot in leap and common years", () => {
    expect(cyclePosition("dayOfYear", "2023-03-01")).toBe(60);
    expect(cyclePosition("dayOfYear", "2024-03-01")).toBe(60);
    expect(cyclePosition("dayOfYear", "2024-02-29")).toBe(59);
    expect(cyclePosition("dayOfYear", "2023-12-31")).toBe(365);
    expect(cycleReferenceDate("dayOfYear", 365)).toBe("2000-12-31");
  });

  it("folds every year onto one axis, sorted by position", () => {
    const items = [item("2024-03-05", 1), item("2023-01-10", 2), item("2025-03-20", 3)];
    const buckets = foldByCycle(items, "monthOfYear", (i) => i.date);
    expect(buckets.map((b) => [b.position, b.start, b.items.map((i) => i.value)])).toEqual([
      [0, "2000-01-01", [2]],
      [2, "2000-03-01", [1, 3]],
    ]);
  });

  it("pools a window that wraps around the end of the cycle", () => {
    const items = [item("2024-12-30", 1), item("2025-01-02", 2), item("2025-06-01", 3)];
    const pooled = poolCircularWindow(foldByCycle(items, "dayOfYear", (i) => i.date), "dayOfYear", 7);
    const jan1 = pooled.find((b) => b.start === "2000-01-01");
    expect(jan1?.items.map((i) => i.value).sort()).toEqual([1, 2]);
    // Only positions with something in their window come back.
    expect(pooled.every((b) => b.items.length > 0)).toBe(true);
    expect(pooled.some((b) => b.start === "2000-04-01")).toBe(false);
  });

  it("keys a month fold's occurrences by year-month and day folds by date", () => {
    expect(cycleOccurrenceKey("monthOfYear", "2024-01-15")).toBe("2024-01");
    expect(cycleOccurrenceKey("weekday", "2024-01-15")).toBe("2024-01-15");
  });

  it("names positions without the reference year", () => {
    expect(formatCyclePosition("weekday", "2000-01-07")).toBe("Friday");
    expect(formatCyclePosition("weekday", "2000-01-07", true)).toBe("Fri");
    expect(formatCyclePosition("monthOfYear", "2000-02-01", true)).toBe("Feb");
    expect(formatCyclePosition("dayOfYear", "2000-03-14")).toBe("March 14");
  });
});
