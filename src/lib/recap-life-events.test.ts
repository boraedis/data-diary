import { describe, expect, it } from "vitest";
import { classifyOverlap } from "@/lib/recap-life-events";
import { yearPeriod } from "@/lib/recap";

// Covers the overlap classification (issue #173) — the whole point of the
// life-events section is that it's a pure structural query, so this is
// where its correctness lives. `listRecapLifeEvents` itself is a DB read
// over src/lib/profile.ts's list functions plus this classification; see
// the PR for how it was verified live.

const period = yearPeriod(2025);

describe("classifyOverlap", () => {
  it("ignores ranges entirely before or after the period", () => {
    expect(classifyOverlap(period, "2023-01-01", "2024-12-31")).toBeNull();
    expect(classifyOverlap(period, "2026-01-01", null)).toBeNull();
  });

  it("treats an entry beginning inside the period as started", () => {
    expect(classifyOverlap(period, "2025-03-04", null)).toBe("started");
    expect(classifyOverlap(period, "2025-03-04", "2027-01-01")).toBe("started");
  });

  it("treats an entry finishing inside the period as ended", () => {
    expect(classifyOverlap(period, "2019-06-01", "2025-08-20")).toBe("ended");
  });

  it("keeps both facts when an entry begins and ends inside the period", () => {
    // Collapsing this into "started" would silently drop the ending.
    expect(classifyOverlap(period, "2025-02-01", "2025-11-01")).toBe("started-and-ended");
  });

  it("treats an entry spanning the whole period as throughout", () => {
    expect(classifyOverlap(period, "2015-01-01", "2030-01-01")).toBe("throughout");
  });

  it("reads a null end as ongoing, not as a missing value", () => {
    // The one case most likely to be got wrong: an ongoing entry that
    // started years ago spans the period rather than failing a comparison.
    expect(classifyOverlap(period, "2015-01-01", null)).toBe("throughout");
  });

  it("includes ranges touching the period's own boundaries", () => {
    expect(classifyOverlap(period, "2025-01-01", "2025-12-31")).toBe("started-and-ended");
    expect(classifyOverlap(period, "2025-12-31", null)).toBe("started");
    expect(classifyOverlap(period, "2020-01-01", "2025-01-01")).toBe("ended");
  });

  it("excludes a range ending the day before the period starts", () => {
    expect(classifyOverlap(period, "2020-01-01", "2024-12-31")).toBeNull();
  });
});
