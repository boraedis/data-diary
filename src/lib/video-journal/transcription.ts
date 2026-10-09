import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, videoLogs } from "@/db/schema";
import { getDeepgramKey, transcribeUrl } from "@/lib/video-journal/deepgram";
import { isBlank, journalAfterChoice, type JournalChoice } from "@/lib/video-journal/journal-rules";
import { buildJournalEntry } from "@/lib/video-journal/journal-entry";
import { presignGetObject } from "@/lib/video-journal/r2";
import { TRANSCRIPTION_STALE_MS } from "@/lib/video-journal/video-log-types";
import { assignLogNumber, VideoLogError } from "@/lib/video-journal/video-logs";

// Transcription lifecycle for a stored video log (#341, epic #338):
//   uploaded → transcribing → ready (transcript stored) | failed (reason
//   stored). Kicked off with `after()` from the upload-complete route, so
//   finishing an upload never waits on it, and re-triggered by the Journal
//   page for any log still sitting at `uploaded` (key added later, or the
//   kick-off never ran).
//
// Transcription never writes days.journal on its own. Owner decision on
// #613 (2026-10-08): nothing reaches the journal until the day's
// recordings are finalized and a primary is chosen, so a populated journal
// means the day is done. The journal-writing pieces below
// (resolveJournalChoice, compare-and-set writes, the log block from
// journal-entry.ts) are what finalize builds on.
//
// The Neon HTTP driver has no interactive transactions, so every state
// change that could race is a single conditional UPDATE (compare-and-set),
// not read-then-write.


export function isTranscriptionConfigured(): boolean {
  return getDeepgramKey() !== null;
}

type VideoLogRow = typeof videoLogs.$inferSelect;

/**
 * Atomically moves a log into `transcribing`, or returns null if it isn't
 * claimable (already transcribing, already done, still uploading). Two
 * callers racing for the same log (the upload's kick-off and the page's
 * re-trigger) can't both win.
 */
export async function claimTranscription(id: string): Promise<VideoLogRow | null> {
  const staleBefore = new Date(Date.now() - TRANSCRIPTION_STALE_MS);
  const [row] = await getDb()
    .update(videoLogs)
    .set({ status: "transcribing", transcriptionStartedAt: new Date(), transcriptionError: null, updatedAt: new Date() })
    .where(
      and(
        eq(videoLogs.id, id),
        or(
          inArray(videoLogs.status, ["uploaded", "failed"]),
          and(eq(videoLogs.status, "transcribing"), lt(videoLogs.transcriptionStartedAt, staleBefore)),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** Runs a claimed transcription to completion. Never throws: a failure is
 * recorded on the row, which is how it reaches the UI. */
export async function runTranscription(row: VideoLogRow): Promise<void> {
  const db = getDb();
  try {
    const result = await transcribeUrl(await presignGetObject(row.storageKey));
    await db
      .update(videoLogs)
      .set({
        status: "ready",
        transcript: result.transcript,
        transcriptWords: result.words,
        transcriptLanguage: result.language,
        transcriptionError: null,
        transcribedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoLogs.id, row.id));
  } catch (error) {
    console.error(`[transcription] ${row.id} failed:`, error);
    await db
      .update(videoLogs)
      .set({
        status: "failed",
        transcriptionError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(videoLogs.id, row.id))
      .catch((e) => console.error(`[transcription] could not record failure for ${row.id}:`, e));
  }
}

async function setOutcome(
  id: string,
  outcome: VideoLogRow["journalOutcome"],
  /** The block this log just wrote into the journal, when it wrote one. */
  journalEntry?: string,
): Promise<void> {
  await getDb()
    .update(videoLogs)
    .set({ journalOutcome: outcome, ...(journalEntry !== undefined ? { journalEntry } : {}), updatedAt: new Date() })
    .where(eq(videoLogs.id, id));
}

/** The header + transcript block for a log (journal-entry.ts), making sure
 * it has its log number first. Logs that uploaded before numbering existed
 * get one here. */
async function entryFor(log: VideoLogRow): Promise<string> {
  const logNumber = log.logNumber ?? (await assignLogNumber(log.id));
  return buildJournalEntry({
    id: log.id,
    logNumber,
    recordedAt: log.recordedAt,
    recordedTz: log.recordedTz,
    durationMs: log.durationMs,
    transcript: log.transcript ?? "",
  });
}

/** Writes `journal` only if the day's journal is still what the decision
 * was based on. Returns whether it wrote. */
async function compareAndSetJournal(
  date: string,
  expected: "blank" | string,
  journal: string,
): Promise<boolean> {
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

/**
 * Puts a transcribed log's block into the journal with the user's Replace
 * / Append / Keep: #341's overwrite confirmation, never silently replacing
 * writing. This is the journal-writing step Finalize (#613) builds on; no
 * screen calls it on its own yet. Returns the day's journal afterwards.
 */
export async function resolveJournalChoice(
  id: string,
  choice: JournalChoice,
  /** The journal text the user was looking at when they chose. */
  shownJournal: string | null,
): Promise<string | null> {
  const db = getDb();
  const [log] = await db.select().from(videoLogs).where(eq(videoLogs.id, id)).limit(1);
  if (!log) throw new VideoLogError(404, "No such video log");
  if (log.status !== "ready" || isBlank(log.transcript)) {
    throw new VideoLogError(409, "This recording has no transcript to use");
  }

  const [day] = await db.select({ journal: days.journal }).from(days).where(eq(days.date, log.date)).limit(1);
  const current = day?.journal ?? null;
  // A Replace clicked on a stale page must not wipe an edit saved since
  // (in another tab, or the Write pane). Blank counts as blank either way.
  const stale = isBlank(current) ? !isBlank(shownJournal) : current !== shownJournal;
  if (stale && choice !== "keep") {
    throw new VideoLogError(409, "The journal changed since this page loaded. Reload and choose again.");
  }
  const entry = await entryFor(log);
  const next = journalAfterChoice(choice, current, entry);

  if (choice !== "keep") {
    // And conditional at write time too, for an edit landing in between.
    const written = await compareAndSetJournal(log.date, isBlank(current) ? "blank" : current!, next!);
    if (!written) {
      throw new VideoLogError(409, "The journal changed since this page loaded. Reload and choose again.");
    }
  }

  const outcome = choice === "replace" ? "replaced" : choice === "append" ? "appended" : "kept";
  // Only a Replace leaves the journal equal to this log's block, which is
  // what lets a later re-record recognise it as untouched. After an
  // Append, the journal is writing + block, which correctly reads as
  // writing; the block is still recorded as what this log contributed.
  await setOutcome(id, outcome, choice === "keep" ? undefined : entry);
  return choice === "keep" ? current : next;
}
