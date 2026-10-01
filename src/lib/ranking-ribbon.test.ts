import { describe, expect, it } from "vitest";
import { buildRibbon, type RibbonEvent } from "@/lib/ranking-ribbon";

const at = (y: number, m = 1, d = 1) => new Date(Date.UTC(y, m - 1, d, 12));
const add = (itemId: number, toRank: number, when: Date): RibbonEvent => ({ itemId, title: `Film ${itemId}`, kind: "add", fromRank: null, toRank, at: when });
const move = (itemId: number, fromRank: number, toRank: number, when: Date): RibbonEvent => ({ itemId, title: `Film ${itemId}`, kind: "move", fromRank, toRank, at: when });
const remove = (itemId: number, fromRank: number, when: Date): RibbonEvent => ({ itemId, title: `Film ${itemId}`, kind: "remove", fromRank, toRank: null, at: when });

describe("buildRibbon", () => {
  it("is empty without history", () => {
    expect(buildRibbon([])).toEqual({ columns: [], series: [], since: null });
  });

  it("has one column per year, the current one labelled Now", () => {
    const r = buildRibbon([add(1, 1, at(2022, 3))], at(2024, 6));
    expect(r.columns.map((c) => c.label)).toEqual(["2022", "2023", "Now"]);
  });

  it("reads each column as the list at that year's end", () => {
    const events = [
      add(1, 1, at(2022, 2)),
      add(2, 2, at(2022, 2)),
      // 2023: 2 overtakes 1.
      move(2, 2, 1, at(2023, 5)),
      move(1, 1, 2, at(2023, 5)),
      // 2024: 1 is dropped.
      remove(1, 2, at(2024, 2)),
    ];
    const r = buildRibbon(events, at(2024, 6));
    const ranks = Object.fromEntries(r.series.map((s) => [s.label, s.ranks]));
    expect(ranks["Film 1"]).toEqual([1, 2, null]);
    expect(ranks["Film 2"]).toEqual([2, 1, 1]);
  });

  it("orders series by first appearance, then rank there", () => {
    const events = [add(7, 2, at(2022)), add(3, 1, at(2022)), add(9, 1, at(2023, 3)), move(3, 1, 2, at(2023, 3)), move(7, 2, 3, at(2023, 3))];
    const r = buildRibbon(events, at(2023, 6));
    expect(r.series.map((s) => s.id)).toEqual(["3", "7", "9"]);
  });

  it("repeats the last list through a year with no changes", () => {
    const r = buildRibbon([add(1, 1, at(2021))], at(2023, 6));
    expect(r.series[0].ranks).toEqual([1, 1, 1]);
  });

  it("ignores events after now", () => {
    const r = buildRibbon([add(1, 1, at(2022)), add(2, 2, at(2030))], at(2022, 6));
    expect(r.series.map((s) => s.id)).toEqual(["1"]);
  });

  it("only draws the top ten", () => {
    const events = Array.from({ length: 12 }, (_, i) => add(i + 1, i + 1, at(2022)));
    expect(buildRibbon(events, at(2022, 6)).series).toHaveLength(10);
  });
});
