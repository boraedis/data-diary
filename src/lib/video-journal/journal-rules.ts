// What Finalize does to `days.journal` (#613, epic #338), as pure functions
// so the rules can be tested without a database.
//
// Finalize is the only thing that writes a recording into the journal.
// Owner decisions on #613 (2026-10-08): transcription never touches the
// journal, the day counts as done once its journal has text, and a
// transcript never silently replaces writing (#338's revision of the
// epic's original "overwrite outright"). So when the primary recording's
// log block (journal-entry.ts) goes in:
//
// 1. An empty journal is filled.
// 2. A journal that is exactly a block a recording previously wrote,
//    untouched, is replaced: that's re-finalizing the day after recording
//    again. Exact match against the stored block (video_logs.journal_entry),
//    so even a whitespace edit counts as writing.
// 3. A journal that already is this exact block needs no write
//    (finalizing again with the same primary).
// 4. Anything else (writing, or an edited block) waits for the user's
//    choice: add below, replace, or keep the writing only.

export type FinalizeJournalDecision =
  /** Write the block, conditional on the journal still being `expected`
   * ("blank", or the exact earlier block being replaced) so a concurrent
   * edit makes the write fail instead of being clobbered. */
  | { kind: "write"; expected: "blank" | string }
  | { kind: "unchanged" }
  | { kind: "needs-choice" };

export function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim() === "";
}

export function decideFinalizeJournal({
  currentJournal,
  entry,
  previousEntries,
}: {
  currentJournal: string | null;
  /** The primary recording's block, as it would be written. */
  entry: string;
  /** Blocks the day's recordings wrote into the journal before, as
   * stored on their rows (journal_entry). */
  previousEntries: (string | null)[];
}): FinalizeJournalDecision {
  if (isBlank(currentJournal)) return { kind: "write", expected: "blank" };
  if (currentJournal === entry) return { kind: "unchanged" };
  if (previousEntries.some((e) => e !== null && e === currentJournal)) {
    return { kind: "write", expected: currentJournal! };
  }
  return { kind: "needs-choice" };
}

export type JournalChoice = "replace" | "append" | "keep";

/** The journal text after the user's choice when it already held writing.
 * `entry` is the primary recording's full block (header + transcript). */
export function journalAfterChoice(choice: JournalChoice, currentJournal: string | null, entry: string): string | null {
  switch (choice) {
    case "replace":
      return entry;
    case "append":
      return isBlank(currentJournal) ? entry : `${currentJournal!.trimEnd()}\n\n${entry}`;
    case "keep":
      return currentJournal;
  }
}
