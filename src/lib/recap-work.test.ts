import { describe, expect, it } from "vitest";
import type { Occupation } from "@/lib/leaderboards/work";
import { previousPeriod, yearPeriod } from "@/lib/recap";
import { summarizeScreenTime, summarizeWork, type RecapWorkDayRow } from "@/lib/recap-work";

// The work & screen time rules (#530): days worked reads `dayType` and is
// covered by typed days; hours average over days actually worked; jobs are
// credited the job leaderboard's way; Instagram is a share of phone time,
// never added to it; followers report where each period ended.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

const row = (date: string, overrides: Partial<RecapWorkDayRow> = {}): RecapWorkDayRow => ({
  date,
  minutes: null,
  productivity: null,
  locations: [],
  commute: [],
  dayType: null,
  happiness: null,
  phoneMinutes: null,
  laptopMinutes: null,
  instagramMinutes: null,
  instagramFollowers: null,
  ...overrides,
});

const job = (o: Partial<Occupation> & Pick<Occupation, "id" | "name" | "start">): Occupation => ({
  type: "work",
  alias: null,
  company: null,
  position: null,
  end: null,
  color: null,
  roles: [],
  ...o,
});

describe("summarizeWork", () => {
  it("counts work days against typed days, per period", () => {
    const result = summarizeWork(
      [
        row("2024-05-01", { dayType: "work" }),
        row("2025-01-01", { dayType: "work" }),
        row("2025-01-02", { dayType: "dayoff" }),
        row("2025-01-03"),
      ],
      [],
      period,
      prior,
    );
    expect(result).toMatchObject({ daysWorked: 1, daysTyped: 2, priorDaysWorked: 1, priorDaysTyped: 1 });
  });

  it("averages hours over days worked, not over recorded zeros", () => {
    const result = summarizeWork(
      [
        row("2025-06-01", { minutes: 480 }),
        row("2025-06-02", { minutes: 360 }),
        row("2025-06-03", { minutes: 0 }),
      ],
      [],
      period,
      prior,
    );
    expect(result.hours).toMatchObject({ average: 7, daysLogged: 2, total: 14 });
  });

  it("has no hours or productivity for a period before they were tracked", () => {
    const result = summarizeWork([row("2025-03-01", { dayType: "work" })], [], period, prior);
    expect(result.hours).toMatchObject({ average: null, daysLogged: 0 });
    expect(result.productivity).toMatchObject({ average: null, daysLogged: 0 });
  });

  it("credits work days to the jobs active in the period, and ignores the prior period", () => {
    const acme = job({ id: 1, name: "Acme", start: "2024-01-01", end: "2025-03-31" });
    const globex = job({ id: 2, name: "Globex", start: "2025-04-01" });
    const result = summarizeWork(
      [
        row("2024-12-01", { dayType: "work" }),
        row("2025-02-01", { dayType: "work" }),
        row("2025-05-01", { dayType: "work" }),
        row("2025-05-02", { dayType: "work" }),
        row("2025-05-03", { dayType: "dayoff" }),
      ],
      [acme, globex],
      period,
      prior,
    );
    expect(result.jobs.map((r) => [r.name, r.value])).toEqual([
      ["Globex", 2],
      ["Acme", 1],
    ]);
    expect(result.jobs[0].previousRanks).toBeNull();
  });

  it("credits locations and commute, with a located day and no commute as 'No commute'", () => {
    const result = summarizeWork(
      [
        row("2025-02-01", { locations: ["home"] }),
        row("2025-02-02", { locations: ["office"], commute: ["walk"] }),
        row("2025-02-03", { locations: ["home"] }),
      ],
      [],
      period,
      prior,
    );
    expect(result.locations.map((r) => [r.name, r.value])).toEqual([
      ["Home", 2],
      ["Office", 1],
    ]);
    expect(result.commute.map((r) => [r.name, r.value])).toEqual([
      ["No commute", 2],
      ["Walk", 1],
    ]);
  });
});

describe("summarizeScreenTime", () => {
  it("averages each device over its own logged days", () => {
    const result = summarizeScreenTime(
      [
        row("2025-01-01", { phoneMinutes: 120, laptopMinutes: 300 }),
        row("2025-01-02", { phoneMinutes: 180 }),
        row("2024-01-01", { phoneMinutes: 60 }),
      ],
      period,
      prior,
    );
    expect(result.phone).toMatchObject({ average: 150, daysLogged: 2, priorAverage: 60 });
    expect(result.laptop).toMatchObject({ average: 300, daysLogged: 1 });
  });

  it("reports Instagram as a share of phone time on days that logged both", () => {
    const result = summarizeScreenTime(
      [
        row("2025-01-01", { phoneMinutes: 200, instagramMinutes: 50 }),
        // Phone-only day: must not dilute the share.
        row("2025-01-02", { phoneMinutes: 400 }),
      ],
      period,
      prior,
    );
    expect(result.instagramShare).toBe(0.25);
    expect(result.instagram).toMatchObject({ average: 50, daysLogged: 1 });
  });

  it("has no share when nothing logged both", () => {
    expect(summarizeScreenTime([row("2025-01-01", { phoneMinutes: 100 })], period, prior).instagramShare).toBeNull();
  });

  it("reports followers as where each period ended", () => {
    const result = summarizeScreenTime(
      [
        row("2024-06-01", { instagramFollowers: 900 }),
        row("2024-12-30", { instagramFollowers: 950 }),
        row("2025-01-05", { instagramFollowers: 960 }),
        row("2025-12-20", { instagramFollowers: 1100 }),
      ],
      period,
      prior,
    );
    expect(result.followers).toEqual({
      first: { date: "2025-01-05", value: 960 },
      last: { date: "2025-12-20", value: 1100 },
      priorLast: { date: "2024-12-30", value: 950 },
      daysLogged: 2,
      priorDaysLogged: 2,
    });
  });
});
