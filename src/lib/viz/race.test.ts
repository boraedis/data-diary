import { describe, expect, it } from "vitest";
import { interpolateDate, interpolateStandings, leaderValue, raceLabels, type RaceFrame } from "./race";

const d = (iso: string) => new Date(iso);

const FRAMES: RaceFrame[] = [
  {
    date: d("2024-01-01"),
    entries: [
      { label: "Ana", value: 10 },
      { label: "Bo", value: 4 },
    ],
  },
  {
    date: d("2024-02-01"),
    entries: [
      { label: "Ana", value: 20 },
      { label: "Bo", value: 40 },
      { label: "Cy", value: 5 },
    ],
  },
];

const byLabel = (standings: { label: string; value: number; rank: number }[]) =>
  Object.fromEntries(standings.map((s) => [s.label, s]));

describe("raceLabels", () => {
  it("lists every label once, in first-appearance order", () => {
    expect(raceLabels(FRAMES)).toEqual(["Ana", "Bo", "Cy"]);
  });

  it("is empty for no frames", () => {
    expect(raceLabels([])).toEqual([]);
  });
});

describe("interpolateStandings", () => {
  it("returns a frame's own values at a whole position", () => {
    expect(byLabel(interpolateStandings(FRAMES, 0))).toMatchObject({
      Ana: { value: 10, rank: 0 },
      Bo: { value: 4, rank: 1 },
    });
  });

  it("blends linearly between two frames", () => {
    const mid = byLabel(interpolateStandings(FRAMES, 0.5));
    expect(mid.Ana.value).toBe(15);
    expect(mid.Bo.value).toBe(22);
  });

  it("treats a label missing from the earlier frame as zero there", () => {
    // Cy appears only in frame 1, so a quarter of the way in it holds a
    // quarter of its value — it grows out of the baseline rather than
    // popping in at full size.
    expect(byLabel(interpolateStandings(FRAMES, 0.25)).Cy.value).toBeCloseTo(1.25);
  });

  it("re-ranks from the interpolated values, so a lead changes mid-flight", () => {
    // Bo overtakes Ana somewhere between the two frames rather than at one
    // of them: at 0.2 Ana still leads, by 0.5 Bo does.
    expect(interpolateStandings(FRAMES, 0.2)[0].label).toBe("Ana");
    expect(interpolateStandings(FRAMES, 0.5)[0].label).toBe("Bo");
  });

  it("clamps a position outside the range instead of extrapolating", () => {
    expect(interpolateStandings(FRAMES, -3)).toEqual(interpolateStandings(FRAMES, 0));
    expect(interpolateStandings(FRAMES, 99)).toEqual(interpolateStandings(FRAMES, 1));
  });

  it("breaks ties by label so bars don't jitter while standing still", () => {
    const tied: RaceFrame[] = [
      {
        date: d("2024-01-01"),
        entries: [
          { label: "Zed", value: 5 },
          { label: "Abe", value: 5 },
        ],
      },
    ];
    expect(interpolateStandings(tied, 0).map((s) => s.label)).toEqual(["Abe", "Zed"]);
  });

  it("returns nothing for no frames", () => {
    expect(interpolateStandings([], 0)).toEqual([]);
  });
});

describe("interpolateDate", () => {
  it("sweeps between frame dates rather than jumping", () => {
    expect(interpolateDate(FRAMES, 0)).toEqual(d("2024-01-01"));
    expect(interpolateDate(FRAMES, 1)).toEqual(d("2024-02-01"));
    expect(interpolateDate(FRAMES, 0.5)).toEqual(d("2024-01-16T12:00:00.000Z"));
  });

  it("is null for no frames", () => {
    expect(interpolateDate([], 0)).toBeNull();
  });
});

describe("leaderValue", () => {
  it("is the leader's value", () => {
    expect(leaderValue(interpolateStandings(FRAMES, 1))).toBe(40);
  });

  it("floors at 1 so an all-zero opening frame still has a usable scale", () => {
    expect(leaderValue([{ label: "Ana", value: 0, rank: 0 }])).toBe(1);
    expect(leaderValue([])).toBe(1);
  });
});
