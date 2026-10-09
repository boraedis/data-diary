// What a finished transcript does to `days.journal` (#341), as pure
// functions so the rules can be tested without a database. The rules come
// from #338's 2026-10-08 decisions, which revised the epic's original
// "transcript overwrites the journal outright":
//
// 1. Every transcript is kept on its own video_logs row, whatever happens
//    here, so nothing a recording said is ever lost.
// 2. An empty journal is filled automatically.
// 3. Latest wins: a newer recording's transcript replaces an older one,
//    but only while the older one is still sitting in the journal
//    *unedited*. That's what lets a re-record "just work".
// 4. Anything else in the journal (writing, or a transcript that's been
//    edited) is never touched automatically. The user picks Replace,
//    Append or Keep.
// 5. An older recording that finishes transcribing after a newer one is
//    already done never displaces it.

export type SiblingLog = {
  id: string;
  recordedAt: Date;
  status: string;
  transcript: string | null;
  /** The exact block this log wrote into the journal, if it wrote one
   * (header + transcript, journal-entry.ts). */
  journalEntry: string | null;
};

export type JournalDecision =
  /** Write the transcript. `expected` is the journal value the write is
   * conditional on, so a concurrent edit makes it fail rather than be
   * clobbered: "blank" for an empty journal, or the exact text of the
   * unedited earlier transcript being replaced. */
  | { kind: "apply"; expected: "blank" | { text: string; replacingId: string } }
  | { kind: "pending" }
  | { kind: "superseded" }
  /** Nothing to apply: no speech was found. */
  | { kind: "none" };

export function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim() === "";
}

export function decideJournalAction({
  transcript,
  recordedAt,
  currentJournal,
  siblings,
}: {
  transcript: string | null;
  recordedAt: Date;
  currentJournal: string | null;
  /** The day's other video logs. */
  siblings: SiblingLog[];
}): JournalDecision {
  if (isBlank(transcript)) return { kind: "none" };

  const newerDone = siblings.some(
    (s) => s.status === "ready" && !isBlank(s.transcript) && s.recordedAt.getTime() > recordedAt.getTime(),
  );
  if (newerDone) return { kind: "superseded" };

  if (isBlank(currentJournal)) return { kind: "apply", expected: "blank" };

  // Exact match against the block that log actually wrote, header
  // included. Trimming or normalising here would treat a lightly edited
  // entry as untouched and overwrite the edit.
  const untouched = siblings.find((s) => s.journalEntry !== null && s.journalEntry === currentJournal);
  if (untouched) return { kind: "apply", expected: { text: currentJournal!, replacingId: untouched.id } };

  return { kind: "pending" };
}

export type JournalChoice = "replace" | "append" | "keep";

/** The journal text after the user's choice for a pending transcript.
 * `entry` is the log's full journal block (header + transcript). */
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
