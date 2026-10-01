import { describe, expect, it } from "vitest";
import { buildEntertainmentMixPoints } from "@/lib/viz/entertainment-mix";
import type { EntertainmentDay } from "@/lib/charts";

const day = (date: string, o: Partial<EntertainmentDay> = {}): EntertainmentDay => ({
  date,
  movie: 0,
  tv: 0,
  book: 0,
  sports: 0,
  game: 0,
  other: 0,
  ...o,
});

describe("buildEntertainmentMixPoints", () => {
  it("averages hours per calendar day, zero days included", () => {
    const days = [day("2024-02-01", { movie: 2 }), day("2024-02-02"), day("2024-02-03", { tv: 1 }), day("2024-02-04")];
    const [p] = buildEntertainmentMixPoints(days, "month");
    expect(p.values.movie).toBeCloseTo(0.5);
    expect(p.values.tv).toBeCloseTo(0.25);
    expect(p.values.book).toBe(0);
  });

  it("buckets by period, oldest first", () => {
    const days = [day("2024-02-29", { game: 1 }), day("2024-03-01", { game: 3 })];
    const pts = buildEntertainmentMixPoints(days, "month");
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.values.game)).toEqual([1, 3]);
  });
});
