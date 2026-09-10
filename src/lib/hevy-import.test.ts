import { describe, expect, it } from "vitest";
import { parseHevyImport } from "@/lib/hevy-import";
import type { ExerciseCatalogItem } from "@/lib/days";

const CATALOG: ExerciseCatalogItem[] = [
  { id: 1, name: "Bicep Curl", category: "strength" },
  { id: 2, name: "Lying Leg Raise", category: "strength" },
  { id: 3, name: "Squat", category: "strength" },
];

function parse(text: string, opts?: Partial<Parameters<typeof parseHevyImport>[2]>) {
  return parseHevyImport(text, CATALOG, {
    locationId: null,
    sessionTotalMinutes: null,
    openDayDate: "2023-03-28",
    ...opts,
  });
}

const BASIC_TEXT = [
  "Push Day",
  "Tue, Mar 28, 2023 6:00 PM",
  "",
  "Bicep Curl (Dumbbell)",
  "Set 1: 10 reps",
  "Set 2: 135 lbs x 10 reps",
  "",
  "Lying Leg Raise",
  "Set 1: 45s",
].join("\n");

describe("parseHevyImport", () => {
  it("splits exercise name and subtype from parentheses", () => {
    const result = parse(BASIC_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl");
    expect(bicepCurl?.subtype).toBe("Dumbbell");
  });

  it("applies the hardcoded subtype override when there are no parentheses", () => {
    const result = parse(BASIC_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const legRaise = result.workouts.find((w) => w.exerciseName === "Lying Leg Raise");
    expect(legRaise?.subtype).toBe("Body Weight");
  });

  it("leaves subtype null with no parentheses and no override", () => {
    const result = parse(["S", "Tue, Mar 28, 2023", "", "Squat", "Set 1: 10 reps"].join("\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workouts[0].subtype).toBeNull();
  });

  it("parses the reps-only set shape", () => {
    const result = parse(BASIC_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl")!;
    expect(bicepCurl.sets[0]).toEqual({ setNumber: 1, reps: 10, weightLbs: null, durationSeconds: null });
  });

  it("parses the weight+reps set shape", () => {
    const result = parse(BASIC_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl")!;
    expect(bicepCurl.sets[1]).toEqual({ setNumber: 2, reps: 10, weightLbs: 135, durationSeconds: null });
  });

  it("parses a timed set with weight 0, reps 1", () => {
    const result = parse(BASIC_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const legRaise = result.workouts.find((w) => w.exerciseName === "Lying Leg Raise")!;
    expect(legRaise.sets[0]).toEqual({ setNumber: 1, reps: 1, weightLbs: 0, durationSeconds: 45 });
  });

  it("sums multi-token durations (h/min/s)", () => {
    const result = parse(["S", "Tue, Mar 28, 2023", "", "Lying Leg Raise", "Set 1: 1min 5s"].join("\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workouts[0].sets[0].durationSeconds).toBe(65);
  });

  it("merges repeated exercise+subtype occurrences into one, concatenating sets", () => {
    const text = [
      "S",
      "Tue, Mar 28, 2023",
      "",
      "Bicep Curl (Dumbbell)",
      "Set 1: 10 reps",
      "",
      "Squat",
      "Set 1: 5 reps",
      "",
      "Bicep Curl (Dumbbell)",
      "Set 1: 8 reps",
    ].join("\n");
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workouts).toHaveLength(2);
    const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl")!;
    expect(bicepCurl.sets.map((s) => s.reps)).toEqual([10, 8]);
    expect(bicepCurl.sets.map((s) => s.setNumber)).toEqual([1, 2]);
  });

  it("drops exercises with zero parseable sets", () => {
    const text = ["S", "Tue, Mar 28, 2023", "", "Squat", "not a set line"].join("\n");
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workouts).toHaveLength(0);
  });

  it("aborts and reports every unmatched exercise name, not just the first", () => {
    const text = [
      "S",
      "Tue, Mar 28, 2023",
      "",
      "Unknown One",
      "Set 1: 10 reps",
      "",
      "Unknown Two",
      "Set 1: 10 reps",
    ].join("\n");
    const result = parse(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      '"Unknown One" doesn\'t exist in the exercise catalog',
      '"Unknown Two" doesn\'t exist in the exercise catalog',
    ]);
  });

  it("warns when the pasted date doesn't match the open day, without blocking", () => {
    const result = parse(BASIC_TEXT, { openDayDate: "2023-03-27" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dateWarning).toContain("2023-03-28");
    expect(result.dateWarning).toContain("2023-03-27");
  });

  it("doesn't warn when the pasted date matches the open day", () => {
    const result = parse(BASIC_TEXT, { openDayDate: "2023-03-28" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dateWarning).toBeNull();
  });

  describe("duration apportionment", () => {
    it("leaves non-timed exercises' duration null when the session total is left blank", () => {
      const result = parse(BASIC_TEXT, { sessionTotalMinutes: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl")!;
      expect(bicepCurl.durationMinutes).toBeNull();
    });

    it("always gives a timed exercise its own summed duration, regardless of the session total", () => {
      const result = parse(BASIC_TEXT, { sessionTotalMinutes: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const legRaise = result.workouts.find((w) => w.exerciseName === "Lying Leg Raise")!;
      expect(legRaise.durationMinutes).toBe(1); // 45s rounded to the nearest minute
    });

    it("subtracts timed duration from the session total, then divides the rest by non-timed set count", () => {
      // Lying Leg Raise: 45s timed (rounds to 1 minute of the total).
      // Bicep Curl: 2 non-timed sets get the remainder split between them.
      const result = parse(BASIC_TEXT, { sessionTotalMinutes: 21 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const legRaise = result.workouts.find((w) => w.exerciseName === "Lying Leg Raise")!;
      const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl")!;
      expect(legRaise.durationMinutes).toBe(1);
      // remaining = 21 - 45/60 = 20.25 minutes over 2 sets = 10.125/set * 2 sets = 20.25 -> rounds to 20
      expect(bicepCurl.durationMinutes).toBe(20);
    });

    it("apportions by set count, not evenly per exercise", () => {
      const text = [
        "S",
        "Tue, Mar 28, 2023",
        "",
        "Bicep Curl",
        "Set 1: 10 reps",
        "",
        "Squat",
        "Set 1: 10 reps",
        "Set 2: 10 reps",
        "Set 3: 10 reps",
      ].join("\n");
      // 4 total non-timed sets over 40 minutes = 10 min/set.
      const result = parse(text, { sessionTotalMinutes: 40 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const bicepCurl = result.workouts.find((w) => w.exerciseName === "Bicep Curl")!;
      const squat = result.workouts.find((w) => w.exerciseName === "Squat")!;
      expect(bicepCurl.durationMinutes).toBe(10); // 1 set
      expect(squat.durationMinutes).toBe(30); // 3 sets
    });
  });
});
