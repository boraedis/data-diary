import { describe, expect, it } from "vitest";
import { yearPeriod } from "@/lib/recap";
import { summarizeRankingMovement } from "@/lib/recap-ranking";
import type { RibbonEvent } from "@/lib/ranking-ribbon";

// Covers the pure half of the recap's ranking movement (#660): replay at the
// period's edges, the climber, new entries, and the "history doesn't reach
// back" state. Events are written the way `diffRanking` would log them.

const period = yearPeriod(2025);
const titles: Record<number, string> = { 1: "Alien", 2: "Heat", 3: "Ran", 4: "Se7en" };

function event(id: number, at: string, kind: RibbonEvent["kind"], fromRank: number | null, toRank: number | null): RibbonEvent {
  return { itemId: id, title: titles[id], at: new Date(at), kind, fromRank, toRank };
}

// Seeded 2024-06-01 as 1 Alien, 2 Heat, 3 Ran.
const seed = [
  event(1, "2024-06-01T00:00:00Z", "add", null, 1),
  event(2, "2024-06-01T00:00:00Z", "add", null, 2),
  event(3, "2024-06-01T00:00:00Z", "add", null, 3),
];

describe("summarizeRankingMovement", () => {
  it("finds the biggest climber and the new entries", () => {
    const events = [
      ...seed,
      // Ran jumps over Heat and Alien; Se7en enters at 4.
      event(3, "2025-05-01T10:00:00Z", "move", 3, 1),
      event(1, "2025-05-01T10:00:00Z", "move", 1, 2),
      event(2, "2025-05-01T10:00:00Z", "move", 2, 3),
      event(4, "2025-06-01T10:00:00Z", "add", null, 4),
    ];
    expect(summarizeRankingMovement(events, period)).toEqual({
      status: "available",
      climber: { title: "Ran", from: 3, to: 1, places: 2 },
      entries: [{ title: "Se7en", rank: 4 }],
      entryCount: 1,
    });
  });

  it("is available but empty when the ranking was left alone", () => {
    expect(summarizeRankingMovement(seed, period)).toEqual({
      status: "available",
      climber: null,
      entries: [],
      entryCount: 0,
    });
  });

  it("ignores changes after the period ends", () => {
    const events = [...seed, event(3, "2026-01-02T00:00:00Z", "move", 3, 1)];
    expect(summarizeRankingMovement(events, period)).toMatchObject({ climber: null });
  });

  it("does not report a period the history log predates", () => {
    // The seed lands inside 2024, so everything would look newly ranked.
    expect(summarizeRankingMovement(seed, yearPeriod(2024))).toEqual({
      status: "unavailable",
      since: "2024-06-01",
    });
    expect(summarizeRankingMovement([], period)).toEqual({ status: "unavailable", since: null });
  });
});
