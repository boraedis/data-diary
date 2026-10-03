import { describe, expect, it } from "vitest";
import {
  dateInYear,
  parseMonthDay,
  pastYears,
  pickHomeHighlight,
  pickYearMoment,
  recapHrefFor,
  shiftMonthDay,
  windowAround,
  type YearCandidates,
} from "@/lib/on-this-day";
import type { RecapMoment } from "@/lib/recap-moments";

// Covers "on this day" (#522): the month-day calendar edges, and the
// selection rule that decides what Home leads with versus what the full
// page shows.

function moment(date: string, kind: RecapMoment["kind"], magnitude: number): RecapMoment {
  return { date, kind, headline: `${kind} on ${date}`, detail: null, magnitude };
}

describe("month-day handling", () => {
  it("accepts Feb 29 and rejects impossible or malformed days", () => {
    expect(parseMonthDay("02-29")).toBe("02-29");
    expect(parseMonthDay("02-30")).toBeNull();
    expect(parseMonthDay("13-01")).toBeNull();
    expect(parseMonthDay("2-9")).toBeNull();
    expect(parseMonthDay("2025-02-01")).toBeNull();
  });

  it("steps across the year end and onto Feb 29", () => {
    expect(shiftMonthDay("12-31", 1)).toBe("01-01");
    expect(shiftMonthDay("01-01", -1)).toBe("12-31");
    expect(shiftMonthDay("02-28", 1)).toBe("02-29");
    expect(shiftMonthDay("02-29", 1)).toBe("03-01");
    expect(shiftMonthDay("03-01", -1)).toBe("02-29");
  });

  it("falls Feb 29 back to Feb 28 in a non-leap year only", () => {
    expect(dateInYear("02-29", 2024)).toBe("2024-02-29");
    expect(dateInYear("02-29", 2023)).toBe("2023-02-28");
    expect(dateInYear("10-03", 2023)).toBe("2023-10-03");
  });

  it("windows three days either side, across month and year ends", () => {
    expect(windowAround("2023-01-02")).toMatchObject({ start: "2022-12-30", end: "2023-01-05" });
    expect(windowAround("2023-02-28")).toMatchObject({ start: "2023-02-25", end: "2023-03-03" });
  });
});

describe("pastYears", () => {
  it("lists logged years newest first and never the current year", () => {
    expect(pastYears({ first: "2019-06-01", last: "2026-10-02" }, "2026-10-03")).toEqual([
      2025, 2024, 2023, 2022, 2021, 2020, 2019,
    ]);
  });

  it("is empty when the only logged year is the current one", () => {
    expect(pastYears({ first: "2026-01-01", last: "2026-10-02" }, "2026-10-03")).toEqual([]);
  });
});

describe("recapHrefFor", () => {
  it("links a year's recap only once it's published", () => {
    expect(recapHrefFor(2025, "2026-10-03")).toBe("/recap/2025");
    // Inside the publish grace window after the year ends.
    expect(recapHrefFor(2025, "2026-01-02")).toBeNull();
  });
});

describe("pickYearMoment", () => {
  it("prefers magnitude, then the moment closest to the date", () => {
    const year: YearCandidates = {
      year: 2022,
      date: "2022-10-03",
      moments: [
        moment("2022-10-01", "first-genre", 0.4),
        moment("2022-10-05", "first-country", 0.9),
        moment("2022-10-03", "first-country", 0.9),
      ],
    };
    expect(pickYearMoment(year)?.date).toBe("2022-10-03");
  });

  it("includes dips — the full page is the honest view", () => {
    const year: YearCandidates = {
      year: 2022,
      date: "2022-10-03",
      moments: [moment("2022-10-03", "happiness-dip", 1), moment("2022-10-03", "first-genre", 0.4)],
    };
    expect(pickYearMoment(year)?.kind).toBe("happiness-dip");
  });

  it("is null for a year with no moments", () => {
    expect(pickYearMoment({ year: 2022, date: "2022-10-03", moments: [] })).toBeNull();
  });
});

describe("pickHomeHighlight", () => {
  it("picks the single strongest moment across years", () => {
    const years: YearCandidates[] = [
      { year: 2024, date: "2024-10-03", moments: [moment("2024-10-03", "first-genre", 0.4)] },
      { year: 2019, date: "2019-10-03", moments: [moment("2019-10-02", "first-country", 0.9)] },
    ];
    expect(pickHomeHighlight(years)).toMatchObject({ year: 2019, moment: { kind: "first-country" } });
  });

  it("never leads with a dip, however extreme", () => {
    const years: YearCandidates[] = [
      { year: 2024, date: "2024-10-03", moments: [moment("2024-10-03", "happiness-dip", 1)] },
      { year: 2021, date: "2021-10-03", moments: [moment("2021-10-04", "first-genre", 0.4)] },
    ];
    expect(pickHomeHighlight(years)?.moment.kind).toBe("first-genre");
  });

  it("breaks an exact tie toward the newer year", () => {
    const years: YearCandidates[] = [
      { year: 2024, date: "2024-10-03", moments: [moment("2024-10-03", "first-country", 0.9)] },
      { year: 2020, date: "2020-10-03", moments: [moment("2020-10-03", "first-country", 0.9)] },
    ];
    expect(pickHomeHighlight(years)?.year).toBe(2024);
  });

  it("is null when only dips (or nothing) qualify, so Home renders no card", () => {
    expect(pickHomeHighlight([])).toBeNull();
    expect(
      pickHomeHighlight([
        { year: 2024, date: "2024-10-03", moments: [moment("2024-10-03", "happiness-dip", 0.8)] },
      ])
    ).toBeNull();
  });
});
