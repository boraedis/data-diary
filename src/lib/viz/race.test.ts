import { describe, expect, it } from "vitest";
import {
  buildRaceIndex,
  interpolateDate,
  interpolateStandings,
  leaderValue,
  raceLabels,
  type RaceFrame,
} from "./race";

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

const INDEX = buildRaceIndex(FRAMES);

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

describe("buildRaceIndex", () => {
  it("ranks every label in every frame, including ones that aren't in it", () => {
    // Cy has no entry in frame 0, but still needs a position to rise from.
    expect(byLabel([...INDEX.frames[0].values()])).toMatchObject({
      Ana: { value: 10, rank: 0 },
      Bo: { value: 4, rank: 1 },
      Cy: { value: 0, rank: 2 },
    });
  });

  it("breaks ties by label so a ranking is deterministic", () => {
    const tied = buildRaceIndex([
      {
        date: d("2024-01-01"),
        entries: [
          { label: "Zed", value: 5 },
          { label: "Abe", value: 5 },
        ],
      },
    ]);
    expect(tied.frames[0].get("Abe")?.rank).toBe(0);
    expect(tied.frames[0].get("Zed")?.rank).toBe(1);
  });
});

describe("interpolateStandings", () => {
  it("returns a frame's own values at a whole position, ordered by rank", () => {
    const standings = interpolateStandings(INDEX, 0);
    expect(standings.map((s) => s.label)).toEqual(["Ana", "Bo", "Cy"]);
    expect(byLabel(standings)).toMatchObject({
      Ana: { value: 10, rank: 0 },
      Bo: { value: 4, rank: 1 },
    });
  });

  it("blends values linearly between two frames", () => {
    const mid = byLabel(interpolateStandings(INDEX, 0.5));
    expect(mid.Ana.value).toBe(15);
    expect(mid.Bo.value).toBe(22);
  });

  it("treats a label missing from the earlier frame as zero there", () => {
    // Cy appears only in frame 1, so a quarter of the way in it holds a
    // quarter of its value — it grows out of the baseline rather than
    // popping in at full size.
    expect(byLabel(interpolateStandings(INDEX, 0.25)).Cy.value).toBeCloseTo(1.25);
  });

  it("slides rank across the swap rather than flipping it", () => {
    // Ana leads frame 0, Bo leads frame 1. Halfway through, both sit
    // between the two rows — that midpoint is the crossing, and it's only
    // possible because rank is blended rather than recomputed from the
    // interpolated values (which would flip from 0 to 1 in one frame).
    const mid = byLabel(interpolateStandings(INDEX, 0.5));
    expect(mid.Ana.rank).toBe(0.5);
    expect(mid.Bo.rank).toBe(0.5);

    // Early in the period the rank blend is eased, not linear — a tenth of
    // the way in a bar has barely left its row (smoothstep(0.1) = 0.028),
    // so the swap happens as a movement around the midpoint rather than as
    // a constant drift across the whole period.
    const early = byLabel(interpolateStandings(INDEX, 0.1));
    expect(early.Ana.rank).toBeCloseTo(0.028);
    expect(early.Bo.rank).toBeCloseTo(0.972);
    // The value it carries is still blended linearly.
    expect(early.Ana.value).toBeCloseTo(11);
  });

  it("orders by drawn rank, so a bar mid-climb sorts where it is drawn", () => {
    expect(interpolateStandings(INDEX, 0.9).map((s) => s.label)).toEqual(["Bo", "Ana", "Cy"]);
  });

  it("returns only `limit` standings, counting from the leader", () => {
    expect(interpolateStandings(INDEX, 1, 2).map((s) => s.label)).toEqual(["Bo", "Ana"]);
  });

  it("clamps a position outside the range instead of extrapolating", () => {
    expect(interpolateStandings(INDEX, -3)).toEqual(interpolateStandings(INDEX, 0));
    expect(interpolateStandings(INDEX, 99)).toEqual(interpolateStandings(INDEX, 1));
  });

  it("returns nothing for no frames", () => {
    expect(interpolateStandings(buildRaceIndex([]), 0)).toEqual([]);
  });
});

describe("interpolateDate", () => {
  it("sweeps between frame dates rather than jumping", () => {
    expect(interpolateDate(INDEX, 0)).toEqual(d("2024-01-01"));
    expect(interpolateDate(INDEX, 1)).toEqual(d("2024-02-01"));
    expect(interpolateDate(INDEX, 0.5)).toEqual(d("2024-01-16T12:00:00.000Z"));
  });

  it("is null for no frames", () => {
    expect(interpolateDate(buildRaceIndex([]), 0)).toBeNull();
  });
});

describe("leaderValue", () => {
  it("is the largest value, not the top-ranked bar's", () => {
    // Mid-swap the leading *value* and the rank-0 bar are different bars;
    // keying the axis off rank would make it flinch at every lead change.
    expect(leaderValue(interpolateStandings(INDEX, 1))).toBe(40);
    expect(
      leaderValue([
        { label: "a", value: 3, rank: 0 },
        { label: "b", value: 9, rank: 1 },
      ]),
    ).toBe(9);
  });

  it("floors at 1 so an all-zero opening frame still has a usable scale", () => {
    expect(leaderValue([{ label: "Ana", value: 0, rank: 0 }])).toBe(1);
    expect(leaderValue([])).toBe(1);
  });
});
