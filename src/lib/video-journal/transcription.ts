import { and, eq, inArray, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { videoLogs } from "@/db/schema";
import { getDeepgramKey, transcribeUrl } from "@/lib/video-journal/deepgram";
import { presignGetObject } from "@/lib/video-journal/r2";
import { TRANSCRIPTION_STALE_MS } from "@/lib/video-journal/video-log-types";

// Transcription lifecycle for a stored video log (#341, epic #338):
//   uploaded → transcribing → ready (transcript stored) | failed (reason
//   stored). Kicked off with `after()` from the upload-complete route, so
//   finishing an upload never waits on it, and re-triggered by the Journal
//   page for any log still sitting at `uploaded` (key added later, or the
//   kick-off never ran).
//
// Transcription never writes days.journal. Owner decision on #613
// (2026-10-08): nothing reaches the journal until the day's recordings are
// finalized and a primary is chosen (finalize.ts), so a populated journal
// means the day is done.
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
