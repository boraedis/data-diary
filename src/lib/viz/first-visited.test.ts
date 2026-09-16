import { describe, expect, it } from "vitest";
import { formatFirstVisited, formatTravelledFirstVisited } from "@/lib/viz/first-visited";

describe("formatFirstVisited", () => {
  it("reads 'First visited' when the date is after the diary's own start", () => {
    expect(formatFirstVisited("2020-03-14", "2016-01-01")).toBe("First visited Mar 2020");
  });

  it("reads 'First logged' when the date is at or before the diary's own start", () => {
    expect(formatFirstVisited("2016-01-01", "2016-01-01")).toBe("First logged Jan 2016");
    expect(formatFirstVisited("2015-06-01", "2016-01-01")).toBe("First logged Jun 2015");
  });

  it("reads 'First visited' when there's no diary start date to compare against", () => {
    expect(formatFirstVisited("2015-06-01", null)).toBe("First visited Jun 2015");
  });
});

describe("formatTravelledFirstVisited", () => {
  it("formats a real date", () => {
    expect(formatTravelledFirstVisited("2018-07-04")).toBe("First visited Jul 2018");
  });

  it("says the date is unknown rather than omitting the row", () => {
    expect(formatTravelledFirstVisited(null)).toBe("First visited date unknown");
  });
});
