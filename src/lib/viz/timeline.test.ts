import { describe, expect, it } from "vitest";
import { layoutTimeline, type TimelineInterval } from "@/lib/viz/timeline";

const OPEN_END = "2026-06-30";

function interval(id: string, lane: string, start: string, end: string | null): TimelineInterval {
  return { id, lane, label: id, start, end };
}

/** Row assignment keyed by id, the thing every test here actually asserts on. */
function rows(items: TimelineInterval[]): Record<string, number> {
  const layout = layoutTimeline(items, { openEnd: OPEN_END });
  const out: Record<string, number> = {};
  for (const lane of layout.lanes) for (const item of lane.items) out[item.id] = item.row;
  return out;
}

describe("layoutTimeline", () => {
  it("keeps non-overlapping intervals in one sub-lane", () => {
    expect(
      rows([
        interval("a", "Work", "2020-01-01", "2021-01-01"),
        interval("b", "Work", "2022-01-01", "2023-01-01"),
      ]),
    ).toEqual({ a: 0, b: 0 });
  });

  it("stacks overlapping intervals into separate sub-lanes", () => {
    expect(
      rows([
        interval("a", "Work", "2020-01-01", "2023-01-01"),
        interval("b", "Work", "2021-01-01", "2022-01-01"),
      ]),
    ).toEqual({ a: 0, b: 1 });
  });

  it("uses no more sub-lanes than the peak simultaneous overlap", () => {
    // Three overlapping at once, then a fourth that starts after the first
    // two have ended — it should reuse row 0, not open a fourth row.
    const layout = layoutTimeline(
      [
        interval("a", "Work", "2020-01-01", "2020-06-01"),
        interval("b", "Work", "2020-02-01", "2020-05-01"),
        interval("c", "Work", "2020-03-01", "2021-01-01"),
        interval("d", "Work", "2020-07-01", "2020-12-01"),
      ],
      { openEnd: OPEN_END },
    );
    expect(layout.lanes[0].rows).toBe(3);
    const byId = Object.fromEntries(layout.lanes[0].items.map((i) => [i.id, i.row]));
    expect(byId.d).toBe(0);
  });

  it("lets an interval starting the day another ends share a sub-lane", () => {
    // Back-to-back jobs and addresses meet end-to-end constantly; treating
    // that as an overlap would double a lane's height for nothing.
    expect(
      rows([
        interval("a", "Work", "2020-01-01", "2021-01-01"),
        interval("b", "Work", "2021-01-01", "2022-01-01"),
      ]),
    ).toEqual({ a: 0, b: 0 });
  });

  it("sorts by start before assigning, so input order doesn't change the result", () => {
    const inOrder = rows([
      interval("a", "Work", "2020-01-01", "2023-01-01"),
      interval("b", "Work", "2021-01-01", "2022-01-01"),
    ]);
    const reversed = rows([
      interval("b", "Work", "2021-01-01", "2022-01-01"),
      interval("a", "Work", "2020-01-01", "2023-01-01"),
    ]);
    expect(reversed).toEqual(inOrder);
  });

  it("stacks each lane independently and numbers rows across the whole chart", () => {
    const layout = layoutTimeline(
      [
        interval("w1", "Work", "2020-01-01", "2023-01-01"),
        interval("w2", "Work", "2021-01-01", "2022-01-01"),
        interval("h1", "Home", "2020-01-01", "2024-01-01"),
      ],
      { openEnd: OPEN_END },
    );
    expect(layout.lanes.map((l) => [l.lane, l.rows, l.firstRow])).toEqual([
      ["Work", 2, 0],
      ["Home", 1, 2],
    ]);
    expect(layout.totalRows).toBe(3);
    // Home's single row sits below both of Work's, not on top of them.
    expect(layout.lanes[1].items[0].absoluteRow).toBe(2);
  });

  it("orders lanes by first appearance, so the caller controls the axis", () => {
    const layout = layoutTimeline(
      [interval("b", "Home", "2020-01-01", null), interval("a", "Work", "2020-01-01", null)],
      { openEnd: OPEN_END },
    );
    expect(layout.lanes.map((l) => l.lane)).toEqual(["Home", "Work"]);
  });

  it("runs an open-ended interval to `openEnd` and flags it as ongoing", () => {
    const layout = layoutTimeline([interval("a", "Work", "2020-01-01", null)], { openEnd: OPEN_END });
    const item = layout.lanes[0].items[0];
    expect(item.ongoing).toBe(true);
    expect(item.endDate).toEqual(new Date(2026, 5, 30));
  });

  it("does not flag a real end date as ongoing", () => {
    const layout = layoutTimeline([interval("a", "Work", "2020-01-01", "2021-01-01")], { openEnd: OPEN_END });
    expect(layout.lanes[0].items[0].ongoing).toBe(false);
  });

  it("spans the domain across every lane", () => {
    const layout = layoutTimeline(
      [interval("a", "Work", "2015-03-04", "2016-01-01"), interval("b", "Home", "2019-01-01", "2022-11-30")],
      { openEnd: OPEN_END },
    );
    expect(layout.domain).toEqual([new Date(2015, 2, 4), new Date(2022, 10, 30)]);
  });

  it("keeps a backwards interval instead of silently dropping it", () => {
    // Bad data should be visible on the chart, not missing from it.
    const layout = layoutTimeline([interval("a", "Work", "2021-01-01", "2020-01-01")], { openEnd: OPEN_END });
    expect(layout.lanes[0].items).toHaveLength(1);
  });

  it("returns an empty layout for no items rather than throwing", () => {
    expect(layoutTimeline([], { openEnd: OPEN_END })).toEqual({ lanes: [], totalRows: 0, domain: null });
  });
});
