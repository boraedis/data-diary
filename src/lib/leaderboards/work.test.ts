import { describe, expect, it } from "vitest";
import { buildWorkLeaderboard, roleOn, type Occupation } from "@/lib/leaderboards/work";
import type { WorkDay } from "@/lib/work";

// The job leaderboard's crediting rules (#444). Ranking and movement are
// pinned in ranking.test.ts.

const occ = (o: Partial<Occupation> & Pick<Occupation, "id" | "name" | "start">): Occupation => ({
  alias: null,
  company: null,
  position: null,
  end: null,
  color: null,
  roles: [],
  ...o,
});

const day = (date: string, overrides: Partial<WorkDay> = {}): WorkDay => ({
  date,
  minutes: null,
  productivity: null,
  locations: [],
  commute: [],
  dayType: "work",
  happiness: null,
  ...overrides,
});

const byName = (rows: { name: string; value: number }[]) => rows.map((r) => [r.name, r.value]);

const uni = occ({ id: 1, name: "Undergrad", company: "GT", start: "2020-01-01", end: "2020-12-31" });
const coop = occ({ id: 2, name: "Co-op", company: "Delta", start: "2020-06-01", end: "2020-06-30" });
const coop2 = occ({ id: 3, name: "Co-op", company: "Delta", start: "2021-06-01", end: "2021-06-30" });

describe("buildWorkLeaderboard", () => {
  it("credits a work day to every job active on its date", () => {
    const rows = buildWorkLeaderboard([day("2020-03-01"), day("2020-06-10")], [uni, coop], "job", "days");
    expect(byName(rows)).toEqual([
      ["Undergrad", 2],
      ["Co-op", 1],
    ]);
  });

  it("only counts work days on the days measure", () => {
    const rows = buildWorkLeaderboard([day("2020-03-01", { dayType: "dayoff" })], [uni], "job", "days");
    expect(rows).toEqual([]);
  });

  it("keeps two stints as two jobs but merges them by company", () => {
    const days = [day("2020-06-10"), day("2021-06-10")];
    expect(buildWorkLeaderboard(days, [coop, coop2], "job", "days")).toHaveLength(2);
    expect(byName(buildWorkLeaderboard(days, [coop, coop2], "company", "days"))).toEqual([["Delta", 2]]);
  });

  it("splits hours evenly across a day's credits so totals stay real", () => {
    const rows = buildWorkLeaderboard(
      [day("2026-06-01", { minutes: 480, locations: ["home", "office"] })],
      [],
      "location",
      "hours",
    );
    expect(byName(rows).sort()).toEqual([
      ["Home", 4],
      ["Office", 4],
    ]);
  });

  it("counts a split location day once toward each on the days measure", () => {
    const rows = buildWorkLeaderboard(
      [day("2026-06-01", { locations: ["home", "office"] }), day("2026-06-02", { locations: ["home"] })],
      [],
      "location",
      "days",
    );
    expect(byName(rows)).toEqual([
      ["Home", 2],
      ["Office", 1],
    ]);
  });
});

describe("roleOn", () => {
  const job = occ({
    id: 9,
    name: "Consultant",
    position: "Consultant (generic)",
    start: "2023-01-01",
    roles: [
      { position: "Senior", start: "2024-01-01", end: null },
      { position: "Associate", start: "2023-01-01", end: null },
    ],
  });

  it("runs each role until the next begins", () => {
    expect(roleOn(job, "2023-06-01")).toBe("Associate");
    expect(roleOn(job, "2024-01-01")).toBe("Senior");
  });

  it("falls back to the job's position when no role covers the date", () => {
    expect(roleOn(occ({ id: 1, name: "x", position: "Analyst", start: "2020-01-01" }), "2020-05-01")).toBe("Analyst");
  });
});
