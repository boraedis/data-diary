import { describe, expect, it } from "vitest";
import { daysSinceLatestListen, importFreshness } from "@/lib/music-staleness";

describe("importFreshness", () => {
  it("is fresh under 30 days", () => {
    expect(importFreshness(0)).toBe("fresh");
    expect(importFreshness(29)).toBe("fresh");
  });

  it("is due from 30 up to 59 days", () => {
    expect(importFreshness(30)).toBe("due");
    expect(importFreshness(59)).toBe("due");
  });

  it("is overdue from 60 days", () => {
    expect(importFreshness(60)).toBe("overdue");
    expect(importFreshness(400)).toBe("overdue");
  });
});

describe("daysSinceLatestListen", () => {
  // Noon UTC keeps the calendar date the same for any timezone the test
  // runner might be in, so the expectations below don't depend on it.
  it("counts whole calendar days from the newest listen", () => {
    expect(daysSinceLatestListen("2026-09-13T12:00:00Z", "2026-10-13")).toBe(30);
    expect(daysSinceLatestListen("2026-10-13T12:00:00Z", "2026-10-13")).toBe(0);
  });

  it("returns null when nothing has been imported", () => {
    expect(daysSinceLatestListen(null, "2026-10-13")).toBeNull();
  });
});
