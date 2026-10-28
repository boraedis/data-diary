import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import type { DaySnapshot } from "@/lib/expected-fields";
import { detectRangeOutliers, detectRollingOutliers } from "./outlier";
import { detectMissingEntryFields, detectWorkoutJumps } from "./referential";
import type { EntryRow, ScanInput, SetRow } from "./types";

// Covers the type 3 and 4 detectors of the inconsistency scan (#671):
// impossible values, typo-shaped outliers against your own readings,
// entries missing what their siblings have, and workout-set jumps.

const START = "2024-01-01";
const day = (i: number) => addDays(START, i);

function input(parts: Partial<ScanInput>): ScanInput {
  return { snapshots: [], lastJudgedDate: "2030-01-01", ...parts };
}

function days(n: number, make: (i: number) => DaySnapshot["day"]): DaySnapshot[] {
  return Array.from({ length: n }, (_, i) => ({ date: day(i), day: make(i) }));
}

describe("detectRangeOutliers", () => {
  it("flags impossible day values and malformed times", () => {
    const findings = detectRangeOutliers(
      input({
        snapshots: [
          { date: day(0), day: { happiness: 140, weightKg: 80, sleepTime: "25:10" } },
          { date: day(1), day: { happiness: 100, subK: 11, phoneUsageMinutes: 1500 } },
        ],
      })
    );
    expect(findings.map((f) => `${f.date} ${f.field}`)).toEqual([
      `${day(0)} happiness`,
      `${day(0)} sleepTime`,
      `${day(1)} subK`,
      `${day(1)} phoneUsageMinutes`,
    ]);
    expect(findings[0].detail).toBe("Happiness is 140, outside 0 to 100");
  });

  it("checks each entry's duration and a domain's daily total", () => {
    const entry = (id: number, date: string, durationMinutes: number): EntryRow => ({
      table: "game_sessions",
      id,
      date,
      durationMinutes,
      values: {},
    });
    const findings = detectRangeOutliers(
      input({
        entries: [
          entry(1, day(0), 1800), // 30h: one bad row
          entry(2, day(1), 800),
          entry(3, day(1), 800), // fine alone, 26h together
          entry(4, day(2), 60),
        ],
      })
    );
    expect(findings.map((f) => [f.entityTable, f.entityId ?? null, f.date])).toEqual([
      ["game_sessions", 1, day(0)],
      ["days", null, day(1)],
    ]);
  });
});

describe("detectRollingOutliers", () => {
  const steady = (i: number) => 80 + (i % 3) * 0.2;

  it("flags an isolated typo against the readings around it", () => {
    const snaps = days(30, (i) => ({ weightKg: i === 20 ? 90.1 : steady(i) }));
    const findings = detectRollingOutliers(input({ snapshots: snaps }));
    expect(findings.map((f) => f.date)).toEqual([day(20)]);
    expect(findings[0].detail).toContain("Weight 90.1 kg");
  });

  it("leaves a real level change alone when later readings agree", () => {
    const snaps = days(40, (i) => ({ weightKg: i < 20 ? steady(i) : steady(i) + 8 }));
    expect(detectRollingOutliers(input({ snapshots: snaps }))).toEqual([]);
  });

  it("ignores wobble under the field's floor, however steady the series", () => {
    const snaps = days(30, (i) => ({ weightKg: i === 20 ? 82 : 80 }));
    expect(detectRollingOutliers(input({ snapshots: snaps }))).toEqual([]);
  });

  it("doesn't judge happiness, which swings for real", () => {
    const snaps = days(30, (i) => ({ happiness: i === 20 ? 10 : 80 }));
    expect(detectRollingOutliers(input({ snapshots: snaps }))).toEqual([]);
  });
});

describe("detectMissingEntryFields", () => {
  const watch = (i: number, rating: number | null): EntryRow => ({
    table: "movie_watches",
    id: i + 1,
    date: day(i),
    durationMinutes: 120,
    values: { rating, locationType: "Home" },
  });

  it("flags the one entry missing a field its predecessors all have", () => {
    const rows = Array.from({ length: 40 }, (_, i) => watch(i, i === 30 ? null : 7));
    const findings = detectMissingEntryFields(input({ entries: rows }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ entityTable: "movie_watches", entityId: 31, field: "rating" });
    expect(findings[0].detail).toBe("Movie watch has no rating, unlike 100% of the 30 before it");
  });

  it("leaves a field you only sometimes fill alone", () => {
    const rows = Array.from({ length: 40 }, (_, i) => watch(i, i % 2 ? 7 : null));
    expect(detectMissingEntryFields(input({ entries: rows }))).toEqual([]);
  });

  it("needs enough earlier rows to judge", () => {
    const rows = Array.from({ length: 10 }, (_, i) => watch(i, i === 9 ? null : 7));
    expect(detectMissingEntryFields(input({ entries: rows }))).toEqual([]);
  });
});

describe("detectWorkoutJumps", () => {
  const set = (i: number, weightLbs: number, reps = 8, exercise = "Bench Press · Barbell"): SetRow => ({
    id: i + 1,
    date: day(Math.floor(i / 3)),
    exercise,
    reps,
    weightLbs,
  });

  it("flags a stray-digit weight", () => {
    const sets = Array.from({ length: 30 }, (_, i) => set(i, i === 20 ? 1350 : 135));
    const findings = detectWorkoutJumps(input({ sets }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ entityTable: "workout_sets", entityId: 21, field: "weightLbs" });
  });

  it("leaves a real step up alone when later sets match it", () => {
    const sets = Array.from({ length: 40 }, (_, i) => set(i, i < 20 ? 60 : 110));
    expect(detectWorkoutJumps(input({ sets }))).toEqual([]);
  });

  it("judges each exercise and subtype on its own history", () => {
    const sets = [
      ...Array.from({ length: 15 }, (_, i) => set(i, 50, 8, "Curl · Dumbbell")),
      ...Array.from({ length: 15 }, (_, i) => set(100 + i, 120, 8, "Curl · Barbell")),
    ];
    expect(detectWorkoutJumps(input({ sets }))).toEqual([]);
  });

  it("flags a rep count far past anything recent", () => {
    const sets = Array.from({ length: 30 }, (_, i) => set(i, 135, i === 20 ? 80 : 8));
    expect(detectWorkoutJumps(input({ sets })).map((f) => f.field)).toEqual(["reps"]);
  });
});
