import { describe, expect, it } from "vitest";
import { diffRanking, replayRanking, type RankingEventRow } from "@/lib/ranking-history";

describe("diffRanking", () => {
  it("logs nothing for an identical list", () => {
    expect(diffRanking([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("logs adds and removes with the rank involved", () => {
    expect(diffRanking([1, 2], [1, 3])).toEqual([
      { itemId: 2, kind: "remove", fromRank: 2, toRank: null },
      { itemId: 3, kind: "add", fromRank: null, toRank: 2 },
    ]);
  });

  it("logs a move for every item whose rank changed, including shifted ones", () => {
    const deltas = diffRanking([1, 2, 3], [3, 1, 2]);
    expect(deltas.every((d) => d.kind === "move")).toBe(true);
    expect(deltas.map((d) => [d.itemId, d.fromRank, d.toRank])).toEqual([
      [3, 3, 1],
      [1, 1, 2],
      [2, 2, 3],
    ]);
  });

  it("handles an empty list on either side", () => {
    expect(diffRanking([], [5]).map((d) => d.kind)).toEqual(["add"]);
    expect(diffRanking([5], []).map((d) => d.kind)).toEqual(["remove"]);
  });
});

const at = (h: number) => new Date(Date.UTC(2024, 0, 1, h));
const stamp = (deltas: ReturnType<typeof diffRanking>, h: number): RankingEventRow[] => deltas.map((d) => ({ ...d, at: at(h) }));

describe("replayRanking", () => {
  it("reproduces every list in a sequence of saves, at each point in time", () => {
    const lists = [[1, 2, 3], [3, 1, 2], [3, 1, 4], []];
    const events: RankingEventRow[] = [];
    let prev: number[] = [];
    lists.forEach((list, i) => {
      events.push(...stamp(diffRanking(prev, list), i));
      prev = list;
    });
    lists.forEach((list, i) => expect(replayRanking(events, at(i))).toEqual(list));
  });

  it("ignores events after the as-of instant", () => {
    const events = stamp(diffRanking([], [1, 2]), 5);
    expect(replayRanking(events, at(4))).toEqual([]);
  });
});
