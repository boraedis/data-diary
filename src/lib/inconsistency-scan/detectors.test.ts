import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import type { DaySnapshot } from "@/lib/expected-fields";
import { detectDomainGaps, detectMissingDays } from "./missing";
import { detectPartialDays } from "./partial";
import { detectAll } from "./run";
import { findingKey, type ScanInput } from "./types";

// Covers the type 1 and 2 detectors of the inconsistency scan (#670) on
// fixture histories: which gaps and half-logged days get flagged, and
// that a finding's identity holds steady across runs.

const START = "2024-01-01";

/** `n` consecutive days from `start`, built by `make(i)` (null = no row). */
function history(
  n: number,
  make: (i: number) => Partial<DaySnapshot> | null,
  start = START
): DaySnapshot[] {
  const out: DaySnapshot[] = [];
  for (let i = 0; i < n; i++) {
    const s = make(i);
    if (s) out.push({ date: addDays(start, i), day: s.day ?? null, satellites: s.satellites });
  }
  return out;
}

// Judged up to the last fixture date by default, so the fixture's end
// isn't itself a trailing gap.
function input(snapshots: DaySnapshot[], lastJudgedDate?: string): ScanInput {
  const last = snapshots.map((s) => s.date).sort().at(-1) ?? START;
  return { snapshots, lastJudgedDate: lastJudgedDate ?? last };
}

const LOGGED = { day: { happiness: 60 } };

describe("detectMissingDays", () => {
  it("flags a gap after a regularly logged stretch, once per run of days", () => {
    // 40 logged, 5 skipped, 10 logged.
    const snaps = history(55, (i) => (i >= 40 && i < 45 ? null : LOGGED));
    const findings = detectMissingDays(input(snaps));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: "missing", date: addDays(START, 40) });
    expect(findings[0].detail).toContain("5 days not logged");
  });

  it("treats an existing but empty row as not logged", () => {
    const snaps = history(45, (i) => (i === 40 ? { day: { happiness: null } } : LOGGED));
    expect(detectMissingDays(input(snaps)).map((f) => f.date)).toEqual([addDays(START, 40)]);
  });

  it("ignores gaps inside a sparsely logged stretch", () => {
    // Logged one day in three: nothing regular to break.
    const snaps = history(90, (i) => (i % 3 === 0 ? LOGGED : null));
    expect(detectMissingDays(input(snaps))).toEqual([]);
  });

  it("doesn't judge past lastJudgedDate, or before the first logged day", () => {
    const snaps = history(40, () => LOGGED, "2024-02-01");
    expect(detectMissingDays(input(snaps, "2024-03-20"))).toHaveLength(1); // the trailing gap
    expect(detectMissingDays(input(snaps, addDays("2024-02-01", 39)))).toEqual([]);
  });
});

describe("detectDomainGaps", () => {
  it("flags a domain gap far longer than its usual rhythm", () => {
    // Workouts every other day for 100 days, then none for 30, then back.
    const snaps = history(150, (i) => ({
      day: { happiness: 60 },
      satellites: { workouts: i % 2 === 0 && (i < 100 || i >= 130) ? 1 : 0 },
    }));
    const findings = detectDomainGaps(input(snaps));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ field: "workouts", date: addDays(START, 99) });
  });

  it("flags a habit that stopped, as an ongoing gap", () => {
    const snaps = history(100, (i) => ({
      day: { happiness: 60 },
      satellites: { books: i < 50 ? 1 : 0 },
    }));
    const [finding] = detectDomainGaps(input(snaps));
    expect(finding.detail).toMatch(/^No books since/);
  });

  it("counts logged days only, so an unlogged week doesn't break a streak", () => {
    const snaps = history(100, (i) =>
      i >= 40 && i < 60 ? null : { day: { happiness: 60 }, satellites: { workouts: 1 } }
    );
    expect(detectDomainGaps(input(snaps))).toEqual([]);
  });

  it("skips sports, whose gaps are off seasons", () => {
    const snaps = history(150, (i) => ({
      day: { happiness: 60 },
      satellites: { sports: i < 100 || i >= 130 ? 1 : 0 },
    }));
    expect(detectDomainGaps(input(snaps))).toEqual([]);
  });

  it("leaves rarely used domains alone", () => {
    const snaps = history(100, (i) => ({
      day: { happiness: 60 },
      satellites: { games: i < 5 ? 1 : 0 },
    }));
    expect(detectDomainGaps(input(snaps))).toEqual([]);
  });
});

describe("detectPartialDays", () => {
  const habit = (i: number) => ({ day: { happiness: 60, weightKg: i === 50 ? null : 80 } });

  it("flags a logged day missing a habitual field, listing what's missing", () => {
    const findings = detectPartialDays(input(history(60, habit)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: "partial", date: addDays(START, 50) });
    expect(findings[0].field).toBeUndefined();
    expect(findings[0].detail).toBe("Missing: Weight");
  });

  it("doesn't flag fields you only sometimes fill", () => {
    const snaps = history(60, (i) => ({ day: { happiness: 60, napMinutes: i % 2 ? 20 : null } }));
    expect(detectPartialDays(input(snaps))).toEqual([]);
  });

  it("ignores music, which arrives in bulk imports", () => {
    const snaps = history(60, (i) => ({
      day: { happiness: 60 },
      satellites: { music: i < 55 ? 10 : 0 },
    }));
    expect(detectPartialDays(input(snaps))).toEqual([]);
  });
});

describe("finding identity", () => {
  it("keeps the same key when only the detail changes", () => {
    const a = { type: "partial", entityTable: "days", date: "2024-01-01", detail: "Missing: Weight" } as const;
    expect(findingKey(a)).toBe(findingKey({ ...a, detail: "Missing: Weight, Sub K" }));
    expect(findingKey(a)).not.toBe(findingKey({ ...a, type: "missing" }));
  });

  it("detectAll returns one finding per key across detectors", () => {
    const snaps = history(55, (i) => (i >= 40 && i < 45 ? null : LOGGED));
    const keys = detectAll(input(snaps)).map(findingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
