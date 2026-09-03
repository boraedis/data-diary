import { describe, expect, it } from "vitest";
import { addDays, isValidDateString, parseDate, toDateString, todayDateString } from "@/lib/date";

describe("isValidDateString", () => {
  it("accepts well-formed real calendar dates", () => {
    expect(isValidDateString("2026-02-14")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true); // 2024 is a leap year
  });

  it("rejects a non-leap-year Feb 29 rather than rolling it forward", () => {
    expect(isValidDateString("2026-02-29")).toBe(false);
  });

  it("rejects out-of-range month/day components", () => {
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-01-32")).toBe(false);
    expect(isValidDateString("2026-00-10")).toBe(false);
  });

  it("rejects strings that don't match the pattern at all", () => {
    expect(isValidDateString("2026-2-14")).toBe(false);
    expect(isValidDateString("02/14/2026")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString("not-a-date")).toBe(false);
  });
});

describe("toDateString / parseDate round-trip", () => {
  it("round-trips a date through toDateString and parseDate", () => {
    const dateStr = "2026-03-05";
    expect(toDateString(parseDate(dateStr))).toBe(dateStr);
  });

  it("pads single-digit months and days", () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("parseDate builds from year/month/day fields, not a UTC parse", () => {
    const dt = parseDate("2026-01-15");
    expect(dt.getFullYear()).toBe(2026);
    expect(dt.getMonth()).toBe(0);
    expect(dt.getDate()).toBe(15);
  });
});

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-03-05", 3)).toBe("2026-03-08");
  });

  it("subtracts days with a negative delta", () => {
    expect(addDays("2026-03-05", -10)).toBe("2026-02-23");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("handles Feb 29 on a leap year correctly", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("is a no-op with delta 0", () => {
    expect(addDays("2026-06-15", 0)).toBe("2026-06-15");
  });
});

describe("todayDateString", () => {
  it("returns a well-formed date string matching the local calendar date", () => {
    const result = todayDateString();
    expect(isValidDateString(result)).toBe(true);
    expect(result).toBe(toDateString(new Date()));
  });
});
