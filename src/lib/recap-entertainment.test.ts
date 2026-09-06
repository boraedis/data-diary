import { describe, expect, it } from "vitest";
import { firstSeenInPeriod } from "@/lib/recap-entertainment";
import { yearPeriod } from "@/lib/recap";

// Covers the first-appearance rule (issue #171) — the one piece of real
// logic in the entertainment module, and the one #172 and #174 are meant to
// reuse rather than reimplement. The counts and rankings around it are
// straight aggregate queries; see the PR for how those were verified.

const period = yearPeriod(2025);

describe("firstSeenInPeriod", () => {
  it("reports a key whose only appearances are inside the period", () => {
    expect(
      firstSeenInPeriod(period, [
        { key: "Portishead", date: "2025-04-02" },
        { key: "Portishead", date: "2025-09-30" },
      ])
    ).toEqual(["Portishead"]);
  });

  it("does not report a key that appeared before the period, even if it also appears inside it", () => {
    // The whole point: seeing something this year doesn't make it new.
    expect(
      firstSeenInPeriod(period, [
        { key: "Radiohead", date: "2019-01-05" },
        { key: "Radiohead", date: "2025-06-01" },
      ])
    ).toEqual([]);
  });

  it("does not report a key whose first appearance is after the period", () => {
    expect(firstSeenInPeriod(period, [{ key: "Later", date: "2026-02-01" }])).toEqual([]);
  });

  it("orders results by when they were discovered", () => {
    expect(
      firstSeenInPeriod(period, [
        { key: "Third", date: "2025-11-01" },
        { key: "First", date: "2025-01-09" },
        { key: "Second", date: "2025-06-15" },
      ])
    ).toEqual(["First", "Second", "Third"]);
  });

  it("counts appearances on the period's own boundary days", () => {
    expect(
      firstSeenInPeriod(period, [
        { key: "Opener", date: "2025-01-01" },
        { key: "Closer", date: "2025-12-31" },
      ])
    ).toEqual(["Opener", "Closer"]);
  });

  it("handles a key appearing many times out of order", () => {
    // Order of the input says nothing about which appearance was first.
    expect(
      firstSeenInPeriod(period, [
        { key: "Shuffled", date: "2025-08-01" },
        { key: "Shuffled", date: "2024-12-31" },
        { key: "Shuffled", date: "2025-01-02" },
      ])
    ).toEqual([]);
  });
});
