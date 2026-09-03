import { describe, expect, it } from "vitest";
import { formatCompactNumber, formatDate, formatDuration, formatPercent, formatThousandsNumber } from "@/lib/viz/format";

describe("formatDuration", () => {
  it("formats a whole number of hours without minutes", () => {
    expect(formatDuration(2)).toBe("2h");
  });

  it("formats a sub-hour duration without a leading '0h'", () => {
    expect(formatDuration(0.75)).toBe("45m");
  });

  it("formats a mixed hours-and-minutes duration", () => {
    expect(formatDuration(2.25)).toBe("2h 15m");
  });

  it("rounds to the nearest minute", () => {
    expect(formatDuration(1.008)).toBe("1h"); // 1.008h = 60.48min -> rounds to 60min = 1h
  });

  it("prints '0m' for a duration that rounds to exactly zero, never a blank string", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("clamps negative input to 0 instead of printing a minus sign", () => {
    expect(formatDuration(-3)).toBe("0m");
  });
});

describe("formatDate", () => {
  it("formats with the default 'short' preset", () => {
    expect(formatDate("2026-02-14")).toBe("Feb 14");
  });

  it("formats the 'month' preset as a bare month name", () => {
    expect(formatDate("2026-02-14", "month")).toBe("February");
  });

  it("formats the 'monthYear' preset", () => {
    expect(formatDate("2026-02-14", "monthYear")).toBe("Feb 2026");
  });

  it("formats the 'weekday' preset", () => {
    // 2026-02-14 is a Saturday
    expect(formatDate("2026-02-14", "weekday")).toBe("Sat, Feb 14");
  });

  it("formats the 'weekdayYear' preset", () => {
    expect(formatDate("2026-02-14", "weekdayYear")).toBe("Sat, Feb 14, 2026");
  });
});

describe("formatCompactNumber", () => {
  it("abbreviates thousands", () => {
    expect(formatCompactNumber(12345)).toBe("12.3K");
  });

  it("abbreviates millions", () => {
    expect(formatCompactNumber(3400000)).toBe("3.4M");
  });

  it("leaves small numbers unabbreviated", () => {
    expect(formatCompactNumber(42)).toBe("42");
  });
});

describe("formatThousandsNumber", () => {
  it("adds thousands separators without abbreviating", () => {
    expect(formatThousandsNumber(12345)).toBe("12,345");
  });

  it("leaves small numbers as-is", () => {
    expect(formatThousandsNumber(42)).toBe("42");
  });
});

describe("formatPercent", () => {
  it("formats a 0-1 fraction as a whole percent by default", () => {
    expect(formatPercent(0.42)).toBe("42%");
  });

  it("rounds to the nearest whole percent by default", () => {
    expect(formatPercent(0.426)).toBe("43%");
  });

  it("respects a requested fraction-digit precision", () => {
    expect(formatPercent(0.4261, 1)).toBe("42.6%");
  });

  it("handles 0 and 1 edge cases", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });
});
