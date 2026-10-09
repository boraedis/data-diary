import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, videoLogs } from "@/db/schema";
import { buildJournalEntry } from "@/lib/video-journal/journal-entry";
import { decideFinalizeJournal, isBlank, journalAfterChoice, type JournalChoice } from "@/lib/video-journal/journal-rules";
import { deleteObject } from "@/lib/video-journal/r2";
import { assignLogNumber, VideoLogError } from "@/lib/video-journal/video-logs";

// Finalize (#613, epic #338): the one step that turns a day's recordings
// into its journal. Owner decisions on #613, 2026-10-08:
// - Always explicit, even with one recording. Nothing reaches the journal
//   before it, so "journal has text" is what marks the day done.
// - The chosen recording's log block (journal-entry.ts) goes into the
//   journal under journal-rules.ts: never silently over writing.
// - Every other recording for the day is deleted completely: the R2 video
//   first, then its row, transcript included.
// - It gets the next "Video log #N"; deleted takes never had one.
// - Recording again later and re-finalizing picks among all the day's
//   recordings, the previous primary included.
//
// Order matters for failure. The journal write and the primary's
// finalized mark happen first, then the deletions, each R2-before-row. If
// a deletion fails, the day is still finalized correctly and the leftover
// take stays listed (row intact, pointing at a file that may or may not
// still exist); finalizing again with the same primary is a no-op for
// the journal and retries just the deletions.

/** What the page sends: which recording, the user's choice if the
 * journal held writing, and the journal text it was showing. */
export type FinalizeInput = {
  date: string;
  primaryId: string;
  choice: JournalChoice | null;
  shownJournal: string | null;
};

export type FinalizeResult =
  /** The journal holds writing; ask the user, then call again with a
   * `choice`. Nothing has been changed. */
  | { status: "needs-choice"; entry: string }
  | {
      status: "finalized";
      logNumber: number | null;
      journal: string | null;
      deleted: number;
      /** Takes still uploading from a device were left alone: deleting
       * their rows mid-upload would just have them recreated. */
      skippedUploading: number;
      /** Recordings that couldn't be deleted (R2 or DB error). Finalizing
       * again retries them. */
      deleteErrors: string[];
    };

/** Body for a recording whose transcription found no speech, so the
 * journal still says something and the day still counts as done. */
const NO_SPEECH = "(No speech detected.)";

/** Writes `journal` only if the day's journal is still `expected`
 * ("blank" = null or whitespace). Returns whether it wrote. The Neon HTTP
 * driver has no interactive transactions, so this conditional UPDATE is
 * what stops a concurrent edit being overwritten. */
async function compareAndSetJournal(date: string, expected: "blank" | string, journal: string): Promise<boolean> {
  const condition =
    expected === "blank"
      ? sql`(${days.journal} IS NULL OR btrim(${days.journal}) = '')`
      : eq(days.journal, expected);
  const updated = await getDb()
    .update(days)
    .set({ journal, updatedAt: new Date() })
    .where(and(eq(days.date, date), condition))
    .returning({ date: days.date });
  return updated.length > 0;
}

const STALE_MESSAGE = "The journal changed since this page loaded. Reload and finalize again.";

export async function finalizeDay({ date, primaryId, choice, shownJournal }: FinalizeInput): Promise<FinalizeResult> {
  const db = getDb();
  const logs = await db.select().from(videoLogs).where(eq(videoLogs.date, date)).orderBy(asc(videoLogs.recordedAt));
  const primary = logs.find((l) => l.id === primaryId);
  if (!primary) throw new VideoLogError(404, "That recording isn't one of this day's");
  if (primary.status !== "ready") {
    throw new VideoLogError(409, "That recording hasn't finished transcribing yet");
  }

  const [day] = await db.select({ journal: days.journal }).from(days).where(eq(days.date, date)).limit(1);
  const current = day?.journal ?? null;
  // The page's view of the journal must still be current, or a choice
  // made against old text could replace an edit saved since (another tab,
  // or the Write pane).
  const stale = isBlank(current) ? !isBlank(shownJournal) : current !== shownJournal;
  if (stale) throw new VideoLogError(409, STALE_MESSAGE);

  const logNumber = primary.logNumber ?? (await assignLogNumber(primary.id));
  const entry = buildJournalEntry({
    id: primary.id,
    logNumber,
    recordedAt: primary.recordedAt,
    recordedTz: primary.recordedTz,
    durationMs: primary.durationMs,
    transcript: isBlank(primary.transcript) ? NO_SPEECH : primary.transcript!,
  });

  const decision = decideFinalizeJournal({
    currentJournal: current,
    entry,
    previousEntries: logs.map((l) => l.journalEntry),
  });

  let journal = current;
  let outcome: "applied" | "replaced" | "appended" | "kept";
  if (decision.kind === "write") {
    if (!(await compareAndSetJournal(date, decision.expected, entry))) throw new VideoLogError(409, STALE_MESSAGE);
    journal = entry;
    outcome = "applied";
  } else if (decision.kind === "unchanged") {
    outcome = primary.journalOutcome === "appended" ? "appended" : "applied";
  } else {
    if (!choice) return { status: "needs-choice", entry };
    const next = journalAfterChoice(choice, current, entry);
    if (choice !== "keep") {
      if (!(await compareAndSetJournal(date, isBlank(current) ? "blank" : current!, next!))) {
        throw new VideoLogError(409, STALE_MESSAGE);
      }
      journal = next;
    }
    outcome = choice === "replace" ? "replaced" : choice === "append" ? "appended" : "kept";
  }

  await db
    .update(videoLogs)
    .set({
      finalizedAt: primary.finalizedAt ?? new Date(),
      journalOutcome: outcome,
      // What this recording put in the journal, which is what a later
      // re-finalize recognises as untouched. Nothing, if the user kept
      // their writing only.
      journalEntry: outcome === "kept" ? null : entry,
      updatedAt: new Date(),
    })
    .where(eq(videoLogs.id, primary.id));

  let deleted = 0;
  let skippedUploading = 0;
  const deleteErrors: string[] = [];
  for (const log of logs) {
    if (log.id === primary.id) continue;
    if (log.status === "uploading") {
      skippedUploading++;
      continue;
    }
    try {
      // R2 first: a row is never removed while its video might survive
      // with nothing pointing at it.
      await deleteObject(log.storageKey);
      await db.delete(videoLogs).where(eq(videoLogs.id, log.id));
      deleted++;
    } catch (error) {
      console.error(`[finalize] could not delete ${log.id}:`, error);
      deleteErrors.push(`${log.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { status: "finalized", logNumber, journal, deleted, skippedUploading, deleteErrors };
}
