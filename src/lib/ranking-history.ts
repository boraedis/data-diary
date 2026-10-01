// The pure half of the ranking history (#546): turning a save into a delta
// log, and turning a log back into the list as it stood. Kept free of the
// database so both directions are testable, and so movies and books (and any
// ranking added later) share one definition.

export type RankingEventKind = "add" | "remove" | "move";

/** One change to one item. `add` has only `toRank`, `remove` only
 * `fromRank`, `move` both. Ranks are 1-based, as stored. */
export type RankingDelta = {
  itemId: number;
  kind: RankingEventKind;
  fromRank: number | null;
  toRank: number | null;
};

/**
 * What changed going from `before` to `after`, both best-first lists of item
 * ids. Only what changed is logged: an item that kept its rank produces
 * nothing, so re-saving an identical list logs nothing. Moving an item up
 * shifts everything it jumped over down a place, and those shifts are
 * logged too — exact, and what a rank-over-time chart draws.
 *
 * Output order: removals, then moves, then adds, each by rank. Order is
 * irrelevant to replay (each event names its own item), but stable output
 * keeps the log readable.
 */
export function diffRanking(before: number[], after: number[]): RankingDelta[] {
  const was = new Map(before.map((id, i) => [id, i + 1]));
  const now = new Map(after.map((id, i) => [id, i + 1]));

  const removed: RankingDelta[] = [];
  for (const [itemId, fromRank] of was) {
    if (!now.has(itemId)) removed.push({ itemId, kind: "remove", fromRank, toRank: null });
  }
  const moved: RankingDelta[] = [];
  const added: RankingDelta[] = [];
  for (const [itemId, toRank] of now) {
    const fromRank = was.get(itemId);
    if (fromRank === undefined) added.push({ itemId, kind: "add", fromRank: null, toRank });
    else if (fromRank !== toRank) moved.push({ itemId, kind: "move", fromRank, toRank });
  }
  return [...removed, ...moved, ...added];
}

export type RankingEventRow = RankingDelta & { at: Date };

/**
 * The ranking as it stood at `asOf`: replays every event at or before it, in
 * order (ties on `at` — one save's events share a clock tick — keep the
 * given order, so pass events oldest-first by `at`, then `id`). Returns item
 * ids best-first. An event naming a rank another item already holds
 * overwrites it only transiently: within one save the moves and adds that
 * follow settle every slot, so the result after a whole save is consistent.
 * Ranks are slots, not a sequence, so a list with a gap (events cut off
 * mid-save) simply skips it rather than shifting later items up.
 */
export function replayRanking(events: RankingEventRow[], asOf: Date): number[] {
  const slots = new Map<number, number>(); // item -> rank
  for (const e of events) {
    if (e.at > asOf) continue;
    if (e.kind === "remove") slots.delete(e.itemId);
    else if (e.toRank !== null) slots.set(e.itemId, e.toRank);
  }
  return [...slots.entries()].sort((a, b) => a[1] - b[1]).map(([itemId]) => itemId);
}
