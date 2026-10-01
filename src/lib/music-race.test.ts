import { describe, expect, it } from "vitest";
import { buildMusicRaceFrames, colorArtistsByTopGenre, type MonthlyArtistRow } from "@/lib/music-race";

const row = (month: string, name: string, hours: number): MonthlyArtistRow => ({ month, name, hours });

describe("buildMusicRaceFrames", () => {
  it("is empty without listens", () => {
    expect(buildMusicRaceFrames([], "cumulative")).toEqual([]);
  });

  it("emits a frame for every month, including ones with no listening", () => {
    const frames = buildMusicRaceFrames([row("2024-01-01", "A", 1), row("2024-03-01", "A", 1)], "cumulative");
    expect(frames).toHaveLength(3);
    expect(frames[1].entries).toEqual([{ label: "A", value: 1 }]);
  });

  it("cumulative running totals only ever grow", () => {
    const frames = buildMusicRaceFrames(
      [row("2024-01-01", "A", 2), row("2024-02-01", "B", 5), row("2024-02-01", "A", 1)],
      "cumulative",
    );
    expect(frames[0].entries).toEqual([{ label: "A", value: 2 }]);
    expect(frames[1].entries).toEqual([
      { label: "B", value: 5 },
      { label: "A", value: 3 },
    ]);
  });

  it("recent mode weights same-month listening in full and fades older months", () => {
    const frames = buildMusicRaceFrames([row("2020-01-01", "Old", 10), row("2024-01-01", "New", 10)], "recent");
    const last = frames[frames.length - 1].entries;
    const value = (label: string) => last.find((e) => e.label === label)?.value ?? 0;
    expect(value("New")).toBeCloseTo(10);
    // Four years on, "Old" is down on its floor, well below the same hours heard now.
    expect(value("Old")).toBeLessThan(1);
    expect(last[0].label).toBe("New");
  });

  it("recent mode lets a leader fall behind where cumulative never would", () => {
    const rows = [row("2020-01-01", "Old", 100), row("2024-01-01", "New", 20)];
    const cum = buildMusicRaceFrames(rows, "cumulative");
    const rec = buildMusicRaceFrames(rows, "recent");
    expect(cum[cum.length - 1].entries[0].label).toBe("Old");
    expect(rec[rec.length - 1].entries[0].label).toBe("New");
  });

  it("keeps only the leaders in each frame", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row("2024-01-01", `A${String(i).padStart(2, "0")}`, i + 1));
    expect(buildMusicRaceFrames(rows, "cumulative")[0].entries).toHaveLength(40);
  });
});

describe("colorArtistsByTopGenre", () => {
  const genres = (...pairs: [string, string, number][]) => pairs.map(([artist, genre, genreHours]) => ({ artist, genre, genreHours }));

  it("gives the five most-listened genres slots in order", () => {
    const rows = genres(
      ["A", "g0", 100],
      ["B", "g1", 90],
      ["C", "g2", 80],
      ["D", "g3", 70],
      ["E", "g4", 60],
      ["F", "g5", 50],
    );
    const { slotByArtist, legend } = colorArtistsByTopGenre(rows);
    expect(legend.map((l) => l.genre)).toEqual(["g0", "g1", "g2", "g3", "g4"]);
    expect(slotByArtist).toEqual({ A: 0, B: 1, C: 2, D: 3, E: 4 });
    expect(slotByArtist.F).toBeUndefined(); // sixth genre folds to the neutral
  });

  it("colours an artist by their highest-ranked genre", () => {
    const rows = genres(["A", "rare", 1], ["A", "common", 99], ["B", "common", 99]);
    expect(colorArtistsByTopGenre(rows).slotByArtist.A).toBe(0);
  });

  it("colours an artist from a slotted genre whenever they have one", () => {
    // Top-five membership is by genre rank, so an artist's best genre is the
    // slotted one whenever they have any slotted genre at all.
    const rows = genres(
      ["A", "g0", 100], ["B", "g1", 90], ["C", "g2", 80], ["D", "g3", 70], ["E", "g4", 60],
      ["Z", "g9", 1], ["Z", "g0", 100],
    );
    expect(colorArtistsByTopGenre(rows).slotByArtist.Z).toBe(0);
  });
});
