import { describe, expect, it } from "vitest";
import {
  MIN_DAYS_FOR_AVERAGE,
  firstSeenInPeriod,
  MIN_DAYS_FOR_TOTAL,
  monthPeriod,
  monthSegment,
  monthsInRange,
  parseMonthSegment,
  parseYearSegment,
  periodUnit,
  periodLengthDays,
  previousPeriod,
  toRecapStat,
  yearPeriod,
} from "@/lib/recap";

// Covers the pure half of the recap foundation (issue #169) — the period
// contract and the coverage rule. The DB-backed functions alongside them
// (listRecapYears/countLoggedDays/getRecapDataRange) aren't covered here;
// see the PR for what was and wasn't verified live.

describe("yearPeriod / periodLengthDays", () => {
  it("spans the whole calendar year, inclusive", () => {
    expect(yearPeriod(2025)).toEqual({ start: "2025-01-01", end: "2025-12-31", label: "2025" });
    expect(periodLengthDays(yearPeriod(2025))).toBe(365);
  });

  it("counts the extra day in a leap year", () => {
    expect(periodLengthDays(yearPeriod(2024))).toBe(366);
  });

  it("counts a single-day period as one day, not zero", () => {
    expect(periodLengthDays({ start: "2025-03-04", end: "2025-03-04", label: "one day" })).toBe(1);
  });
});

describe("previousPeriod", () => {
  it("steps a calendar year back to the whole previous calendar year", () => {
    expect(previousPeriod(yearPeriod(2025))).toEqual(yearPeriod(2024));
  });

  it("does not drift across a leap year", () => {
    // The reason calendar years are special-cased: shifting 2025 back by
    // its own 365 days would land on 2024-01-02, dragging the comparison
    // window a day out of alignment (and further with each leap year
    // crossed, which matters because every historical year gets generated).
    expect(previousPeriod(yearPeriod(2025)).start).toBe("2024-01-01");
    expect(previousPeriod(yearPeriod(2024))).toEqual(yearPeriod(2023));
  });

  it("shifts an arbitrary window back by its own length, ending the day before it starts", () => {
    // Not a whole calendar month — those step back a calendar month (below).
    const period = { start: "2025-06-10", end: "2025-07-09", label: "a window" };
    const previous = previousPeriod(period);
    expect(previous.end).toBe("2025-06-09");
    expect(previous.start).toBe("2025-05-11");
    expect(periodLengthDays(previous)).toBe(periodLengthDays(period));
  });

  it("steps a calendar month back to the whole previous calendar month", () => {
    // Equal-length shifting would compare March against Jan 29 - Feb 28.
    expect(previousPeriod(monthPeriod(2025, 3))).toEqual(monthPeriod(2025, 2));
    expect(previousPeriod(monthPeriod(2024, 3)).start).toBe("2024-02-01");
  });

  it("steps January back across the year boundary", () => {
    expect(previousPeriod(monthPeriod(2025, 1))).toEqual(monthPeriod(2024, 12));
  });
});

describe("monthPeriod / periodUnit", () => {
  it("spans the whole month, inclusive, with the right length", () => {
    const march = monthPeriod(2025, 3);
    expect(march.start).toBe("2025-03-01");
    expect(march.end).toBe("2025-03-31");
    expect(periodLengthDays(monthPeriod(2025, 4))).toBe(30);
  });

  it("knows February's length in leap and common years", () => {
    expect(monthPeriod(2024, 2).end).toBe("2024-02-29");
    expect(monthPeriod(2025, 2).end).toBe("2025-02-28");
  });

  it("classifies periods by their bounds", () => {
    expect(periodUnit(yearPeriod(2025))).toBe("year");
    expect(periodUnit(monthPeriod(2025, 12))).toBe("month");
    expect(periodUnit({ start: "2025-03-02", end: "2025-03-31", label: "x" })).toBeNull();
  });
});

describe("monthsInRange", () => {
  const counts = new Map([
    [6, 20],
    [8, 31],
  ]);

  it("lists only months inside the logged range, with zeros for fallow ones", () => {
    const months = monthsInRange(2015, { first: "2015-06-12", last: "2025-01-01" }, counts);
    expect(months.map((m) => m.month)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(months.find((m) => m.month === 7)?.loggedDays).toBe(0);
    expect(months.find((m) => m.month === 8)?.loggedDays).toBe(31);
  });

  it("stops at the last logged month", () => {
    const months = monthsInRange(2026, { first: "2015-06-12", last: "2026-09-03" }, new Map());
    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("parseMonthSegment / monthSegment", () => {
  it("round-trips every month", () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(parseMonthSegment(monthSegment(month))).toBe(month);
    }
  });

  it("rejects anything else, including unpadded months", () => {
    for (const segment of ["3", "00", "13", "003", "ab", "", "-1"]) {
      expect(parseMonthSegment(segment)).toBeNull();
    }
  });
});

describe("toRecapStat", () => {
  it("reports insufficient coverage below the card's own threshold", () => {
    const stat = toRecapStat({ value: 62, loggedDays: 5, requiredDays: MIN_DAYS_FOR_AVERAGE });
    expect(stat).toEqual({ status: "insufficient", loggedDays: 5, requiredDays: MIN_DAYS_FOR_AVERAGE });
  });

  it("lets a total through on a single logged day, where an average would not pass", () => {
    expect(toRecapStat({ value: 3, loggedDays: 1, requiredDays: MIN_DAYS_FOR_TOTAL }).status).toBe("ok");
    expect(toRecapStat({ value: 3, loggedDays: 1, requiredDays: MIN_DAYS_FOR_AVERAGE }).status).toBe(
      "insufficient"
    );
  });

  it("keeps a comparison when both periods clear the threshold", () => {
    const stat = toRecapStat({
      value: 71,
      loggedDays: 300,
      requiredDays: MIN_DAYS_FOR_AVERAGE,
      prior: 64,
      priorLoggedDays: 280,
    });
    expect(stat).toEqual({ status: "ok", value: 71, prior: 64 });
  });

  it("drops a comparison against a prior period that is itself too sparse", () => {
    // An authoritative-looking delta measured against four logged days is
    // worse than no delta at all.
    const stat = toRecapStat({
      value: 71,
      loggedDays: 300,
      requiredDays: MIN_DAYS_FOR_AVERAGE,
      prior: 64,
      priorLoggedDays: 4,
    });
    expect(stat).toEqual({ status: "ok", value: 71, prior: null });
  });

  it("has no comparison at all for the earliest period with data", () => {
    const stat = toRecapStat({ value: 71, loggedDays: 300, requiredDays: MIN_DAYS_FOR_AVERAGE });
    expect(stat).toEqual({ status: "ok", value: 71, prior: null });
  });
});

describe("parseYearSegment", () => {
  it("accepts a four-digit year", () => {
    expect(parseYearSegment("2025")).toBe(2025);
  });

  it("rejects anything else", () => {
    for (const segment of ["25", "20255", "2o25", "", "-2025", "2025-01"]) {
      expect(parseYearSegment(segment)).toBeNull();
    }
  });
});

const firstSeenPeriod = yearPeriod(2025);

describe("firstSeenInPeriod", () => {
  it("reports a key whose only appearances are inside the period", () => {
    expect(
      firstSeenInPeriod(firstSeenPeriod, [
        { key: "Portishead", date: "2025-04-02" },
        { key: "Portishead", date: "2025-09-30" },
      ])
    ).toEqual(["Portishead"]);
  });

  it("does not report a key that appeared before the period, even if it also appears inside it", () => {
    // The whole point: seeing something this year doesn't make it new.
    expect(
      firstSeenInPeriod(firstSeenPeriod, [
        { key: "Radiohead", date: "2019-01-05" },
        { key: "Radiohead", date: "2025-06-01" },
      ])
    ).toEqual([]);
  });

  it("does not report a key whose first appearance is after the period", () => {
    expect(firstSeenInPeriod(firstSeenPeriod, [{ key: "Later", date: "2026-02-01" }])).toEqual([]);
  });

  it("orders results by when they were discovered", () => {
    expect(
      firstSeenInPeriod(firstSeenPeriod, [
        { key: "Third", date: "2025-11-01" },
        { key: "First", date: "2025-01-09" },
        { key: "Second", date: "2025-06-15" },
      ])
    ).toEqual(["First", "Second", "Third"]);
  });

  it("counts appearances on the period's own boundary days", () => {
    expect(
      firstSeenInPeriod(firstSeenPeriod, [
        { key: "Opener", date: "2025-01-01" },
        { key: "Closer", date: "2025-12-31" },
      ])
    ).toEqual(["Opener", "Closer"]);
  });

  it("handles a key appearing many times out of order", () => {
    // Order of the input says nothing about which appearance was first.
    expect(
      firstSeenInPeriod(firstSeenPeriod, [
        { key: "Shuffled", date: "2025-08-01" },
        { key: "Shuffled", date: "2024-12-31" },
        { key: "Shuffled", date: "2025-01-02" },
      ])
    ).toEqual([]);
  });
});
