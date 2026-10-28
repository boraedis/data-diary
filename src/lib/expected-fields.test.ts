import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import {
  FIELDS,
  HOME_SCORE_COLUMNS,
  HOME_SECTION_COUNT,
  expectedFieldsByDate,
  fillRates,
  getField,
  isDayLogged,
  isFieldFilled,
  scoreDay,
  type DayColumn,
  type DaySnapshot,
} from "@/lib/expected-fields";

// Covers the shared expected-fields registry (#669): what "filled" means
// per field, the home dashboard's 10-section score built on it, and the
// trailing fill-rate rule that decides which fields are expected.

function snap(date: string, day: DaySnapshot["day"], satellites?: DaySnapshot["satellites"]) {
  return { date, day, satellites };
}

function field(key: string) {
  const f = getField(key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
}

describe("isFieldFilled", () => {
  it("counts recorded false on the tri-state sick column, but not null", () => {
    expect(isFieldFilled(field("sick"), snap("2024-01-01", { sick: false }))).toBe(true);
    expect(isFieldFilled(field("sick"), snap("2024-01-01", { sick: null }))).toBe(false);
  });

  it("treats zero as a value, and empty arrays or blank text as not logged", () => {
    expect(isFieldFilled(field("coffees"), snap("2024-01-01", { coffees: 0 }))).toBe(true);
    expect(isFieldFilled(field("commute"), snap("2024-01-01", { commute: [] }))).toBe(false);
    expect(isFieldFilled(field("commute"), snap("2024-01-01", { commute: ["walk"] }))).toBe(true);
    expect(isFieldFilled(field("journal"), snap("2024-01-01", { journal: "  " }))).toBe(false);
  });

  it("fills a grouped field from any of its slots", () => {
    expect(
      isFieldFilled(field("positivePeople"), snap("2024-01-01", { positivePerson4Id: 12 }))
    ).toBe(true);
  });

  it("reads satellite domains from per-date counts", () => {
    expect(isFieldFilled(field("workouts"), snap("2024-01-01", null, { workouts: 2 }))).toBe(true);
    expect(isFieldFilled(field("workouts"), snap("2024-01-01", null, {}))).toBe(false);
    expect(isFieldFilled(field("happiness"), snap("2024-01-01", null))).toBe(false);
  });

  it("only names real days columns", () => {
    // A typo in a column name would make a field silently never fill.
    const sample = new Set(Object.keys(fullDay()));
    for (const f of FIELDS) {
      if (f.source === "day") for (const c of f.columns) expect(sample).toContain(c);
    }
  });
});

describe("scoreDay (home's 10 sections)", () => {
  it("scores 0 for no row and 10 for a full one", () => {
    expect(scoreDay(null)).toBe(0);
    expect(scoreDay(fullDay())).toBe(HOME_SECTION_COUNT);
    expect(HOME_SECTION_COUNT).toBe(10);
  });

  it("scores a section once, however many of its fields are filled", () => {
    expect(scoreDay({ distanceWalkedKm: 3, coffees: 2, sick: false })).toBe(1);
    expect(scoreDay({ happiness: 70, productivity: 60, workDurationMinutes: 480 })).toBe(2);
  });

  it("ignores fields outside the home sections", () => {
    expect(scoreDay({ journal: "a long day", bodyFatPercent: 18 })).toBe(0);
  });

  it("selects every column it scores", () => {
    expect(HOME_SCORE_COLUMNS).toEqual(expect.arrayContaining(["happiness", "subK", "place2Id"]));
    expect(HOME_SCORE_COLUMNS).not.toContain("journal");
  });
});

describe("fillRates", () => {
  it("divides by logged days only, leaving empty days out", () => {
    const { loggedDays, rates } = fillRates([
      snap("2024-01-01", { happiness: 50, weightKg: 80 }),
      snap("2024-01-02", { happiness: 60 }),
      snap("2024-01-03", null),
      snap("2024-01-04", { journal: null }),
    ]);
    expect(loggedDays).toBe(2);
    expect(rates.get("happiness")).toBe(1);
    expect(rates.get("weight")).toBe(0.5);
  });

  it("is zero everywhere with nothing logged", () => {
    expect(fillRates([snap("2024-01-01", null)]).rates.get("happiness")).toBe(0);
  });
});

describe("expectedFieldsByDate", () => {
  const opts = { windowDays: 10, cutoff: 0.8, minLoggedDays: 5 };

  // `n` consecutive days from `start`, built by `make(i)`.
  function run(start: string, n: number, make: (i: number) => DaySnapshot["day"]) {
    return Array.from({ length: n }, (_, i) => snap(addDays(start, i), make(i)));
  }

  it("expects a habitually filled field, not an occasional one", () => {
    const snaps = run("2024-01-01", 12, (i) => ({
      happiness: 50,
      napMinutes: i % 3 === 0 ? 20 : null,
    }));
    const expected = expectedFieldsByDate(snaps, opts).get("2024-01-12")!;
    expect(expected.has("happiness")).toBe(true);
    expect(expected.has("nap")).toBe(false);
  });

  it("expects nothing until there's enough history", () => {
    const snaps = run("2024-01-01", 12, () => ({ happiness: 50 }));
    const byDate = expectedFieldsByDate(snaps, opts);
    expect(byDate.get("2024-01-05")!.size).toBe(0); // 4 logged days before it
    expect(byDate.get("2024-01-06")!.has("happiness")).toBe(true); // 5
  });

  it("judges a date by the days before it, not by itself", () => {
    const snaps = run("2024-01-01", 12, (i) => (i === 11 ? { weightKg: 80 } : { happiness: 50 }));
    const expected = expectedFieldsByDate(snaps, opts).get("2024-01-12")!;
    expect(expected.has("happiness")).toBe(true);
    expect(expected.has("weight")).toBe(false);
  });

  it("follows a habit change once the old days leave the window", () => {
    // Weight logged for the first 10 days, then dropped for 15.
    const snaps = run("2024-01-01", 25, (i) => ({ happiness: 50, weightKg: i < 10 ? 80 : null }));
    const byDate = expectedFieldsByDate(snaps, opts);
    expect(byDate.get("2024-01-11")!.has("weight")).toBe(true);
    expect(byDate.get("2024-01-25")!.has("weight")).toBe(false);
  });

  it("measures the window in calendar days, across gaps and unsorted input", () => {
    const early = run("2024-01-01", 6, () => ({ happiness: 50 }));
    // Two months later: the early days are outside a 10-day window.
    const later = snap("2024-03-01", { happiness: 50 });
    const byDate = expectedFieldsByDate([later, ...early.reverse()], opts);
    expect(byDate.get("2024-03-01")!.size).toBe(0);
    expect(byDate.get("2024-01-06")).toBeDefined();
  });

  it("matches fillRates over the same window", () => {
    const snaps = run("2024-01-01", 40, (i) => ({
      happiness: i % 7 === 0 ? null : 50,
      coffees: i % 2,
      weightKg: i % 4 === 0 ? 80 : null,
    }));
    const date = "2024-02-09";
    const window = snaps.filter((s) => s.date < date && s.date >= addDays(date, -opts.windowDays));
    const { rates } = fillRates(window);
    const expected = expectedFieldsByDate(snaps, opts).get(date)!;
    for (const f of FIELDS) expect(expected.has(f.key)).toBe(rates.get(f.key)! > opts.cutoff);
  });
});

describe("isDayLogged", () => {
  it("counts a satellite-only day as logged", () => {
    expect(isDayLogged(snap("2024-01-01", null, { music: 30 }))).toBe(true);
    expect(isDayLogged(snap("2024-01-01", null))).toBe(false);
  });
});

function fullDay(): NonNullable<DaySnapshot["day"]> {
  return {
    distanceWalkedKm: 3,
    coffees: 1,
    sick: false,
    sleepTime: "23:30",
    wakeTime: "07:30",
    wakeCrossedMidnight: true,
    sleepLocationType: "Home",
    sleepLocationSubtype: null,
    napMinutes: 0,
    happiness: 70,
    happinessReason: "good",
    journal: "entry",
    dayType: null,
    productivity: 60,
    workDurationMinutes: 480,
    workLocation: ["office"],
    commute: ["walk"],
    phoneUsageMinutes: 120,
    laptopUsageMinutes: 300,
    instagramUsageMinutes: 20,
    weightKg: 80,
    bodyFatPercent: 18,
    muscleMassKg: 35,
    instagramFollowers: 500,
    instagramFollowing: 400,
    positivePerson1Id: 1,
    positivePerson2Id: null,
    positivePerson3Id: null,
    positivePerson4Id: null,
    positivePerson5Id: null,
    positivePerson6Id: null,
    positivePerson7Id: null,
    negativePerson1Id: null,
    negativePerson2Id: null,
    negativePerson3Id: null,
    place1Id: 1,
    place2Id: null,
    subA: 5,
    subW: 5,
    subC: 5,
    subL: 5,
    subNi: 5,
    subNO: 5,
    subAd: 5,
    subD: 5,
    subK: 5,
  } satisfies Record<DayColumn, unknown>;
}
