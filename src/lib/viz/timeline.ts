import { parseDate, todayDateString } from "@/lib/date";

// Pure layout for #119's InteractiveTimeline — the Gantt geometry, with no
// D3 and no DOM, so the part most likely to be wrong (overlap stacking) is
// testable directly rather than only through a rendered chart.
//
// Same boundary as bin.ts and hierarchy.ts: this reshapes rows a page has
// already fetched into drawable form. It does no aggregation and knows
// nothing about pixels — the component turns rows and dates into
// coordinates.

/** One interval on the timeline. Dates are "YYYY-MM-DD" strings, the form
 * this app stores and passes around everywhere (see src/lib/date.ts) —
 * never `Date` objects across a boundary, since a bare "YYYY-MM-DD" parsed
 * as UTC prints the wrong calendar day in a negative-offset timezone. */
export type TimelineInterval = {
  id: string;
  /** Which row band this belongs to, e.g. "Residence". Lanes appear on the
   * y-axis in the order they're first seen in `items`, so a caller orders
   * lanes by ordering its own data. */
  lane: string;
  label: string;
  start: string;
  /** `null` means still ongoing — see `openEnd` in `layoutTimeline`. */
  end: string | null;
};

export type LaidOutInterval = TimelineInterval & {
  /** Sub-lane within this item's lane, 0-based. Assigned automatically so
   * overlapping intervals never paint on top of each other. */
  row: number;
  /** Absolute row across the whole chart, counting every lane above this
   * one — what the y scale actually uses. */
  absoluteRow: number;
  startDate: Date;
  endDate: Date;
  /** True when `end` was null and `endDate` is the fallback rather than a
   * real recorded end — the chart draws these differently, and a tooltip
   * that said "ended today" about an ongoing job would simply be wrong. */
  ongoing: boolean;
};

export type TimelineLane = {
  lane: string;
  /** How many sub-lanes this lane needed. 1 unless something overlapped. */
  rows: number;
  /** Absolute row index this lane's first sub-lane sits at. */
  firstRow: number;
  items: LaidOutInterval[];
};

export type TimelineLayout = {
  lanes: TimelineLane[];
  /** Sum of every lane's rows — the height the chart has to find space for. */
  totalRows: number;
  /** Full time extent of everything laid out, for the x scale. Null when
   * there's nothing to draw. */
  domain: [Date, Date] | null;
};

/**
 * Assigns every interval a sub-lane so that no two overlapping intervals in
 * the same lane are drawn on top of each other.
 *
 * Greedy sweep, the same shape legacy's `stack_overlap` used: sort by start,
 * then drop each interval into the first sub-lane whose last occupant has
 * already finished. That's optimal for interval-graph colouring (it uses
 * exactly as many sub-lanes as the lane's maximum simultaneous overlap, no
 * more), which is why it's worth doing properly here once rather than
 * asking every caller to pre-compute a row per item.
 *
 * `openEnd` is the date an interval with `end: null` is treated as running
 * to — today by default. It's a parameter rather than a hardcoded
 * `todayDateString()` call so a test can pin it; a layout function that
 * silently depends on the wall clock can't be asserted on.
 *
 * Zero-length and backwards intervals are kept rather than dropped: an end
 * before its start is bad data worth seeing on the chart (it renders as a
 * minimum-width bar) instead of a row that silently goes missing.
 */
export function layoutTimeline(
  items: TimelineInterval[],
  options?: { openEnd?: string },
): TimelineLayout {
  const openEnd = options?.openEnd ?? todayDateString();

  // First-seen order, not sorted: the caller controls lane order by
  // ordering its own rows, the same way every other primitive here lets
  // data order drive display order.
  const laneOrder: string[] = [];
  const byLane = new Map<string, TimelineInterval[]>();
  for (const item of items) {
    if (!byLane.has(item.lane)) {
      byLane.set(item.lane, []);
      laneOrder.push(item.lane);
    }
    byLane.get(item.lane)!.push(item);
  }

  const lanes: TimelineLane[] = [];
  let nextAbsoluteRow = 0;

  for (const lane of laneOrder) {
    const laneItems = [...byLane.get(lane)!].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    // The end date currently occupying each sub-lane, by row index.
    const rowEnds: string[] = [];
    const laidOut: LaidOutInterval[] = [];

    for (const item of laneItems) {
      const end = item.end ?? openEnd;
      // `<=`, not `<`: an interval starting the same day another ended
      // shares a sub-lane rather than forcing a second one. Adjacent jobs
      // and addresses routinely meet end-to-end, and treating a shared
      // boundary day as an overlap would double a lane's height for
      // nothing.
      let row = rowEnds.findIndex((occupiedUntil) => occupiedUntil <= item.start);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(end);
      } else {
        // Keep the later end — an out-of-order pair shouldn't shrink the
        // sub-lane's occupied span back.
        rowEnds[row] = end > rowEnds[row] ? end : rowEnds[row];
      }
      laidOut.push({
        ...item,
        row,
        absoluteRow: nextAbsoluteRow + row,
        startDate: parseDate(item.start),
        endDate: parseDate(end),
        ongoing: item.end === null,
      });
    }

    lanes.push({ lane, rows: Math.max(1, rowEnds.length), firstRow: nextAbsoluteRow, items: laidOut });
    nextAbsoluteRow += Math.max(1, rowEnds.length);
  }

  let domain: [Date, Date] | null = null;
  for (const lane of lanes) {
    for (const item of lane.items) {
      if (!domain) {
        domain = [item.startDate, item.endDate];
        continue;
      }
      if (item.startDate < domain[0]) domain[0] = item.startDate;
      if (item.endDate > domain[1]) domain[1] = item.endDate;
    }
  }

  return { lanes, totalRows: nextAbsoluteRow, domain };
}
