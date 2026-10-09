import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, videoLogs } from "@/db/schema";
import { getDeepgramKey, transcribeUrl } from "@/lib/video-journal/deepgram";
import {
  decideJournalAction,
  isBlank,
  journalAfterChoice,
  type JournalChoice,
} from "@/lib/video-journal/journal-rules";
import { presignGetObject } from "@/lib/video-journal/r2";
import { TRANSCRIPTION_STALE_MS } from "@/lib/video-journal/video-log-types";
import { VideoLogError } from "@/lib/video-journal/video-logs";

// Transcription lifecycle for a stored video log (#341, epic #338):
//   uploaded → transcribing → ready (transcript stored) | failed (reason
//   stored, journal untouched).
// Then, for `ready`, what the transcript does to days.journal (rules in
// journal-rules.ts). Kicked off with `after()` from the upload-complete
// route, so finishing an upload never waits on it, and re-triggered by the
// Journal page for any log still sitting at `uploaded` (key added later,
// or the kick-off never ran).
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
    await applyTranscriptToJournal(row.id);
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

async function setOutcome(id: string, outcome: VideoLogRow["journalOutcome"]): Promise<void> {
  await getDb().update(videoLogs).set({ journalOutcome: outcome, updatedAt: new Date() }).where(eq(videoLogs.id, id));
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
 * Applies a ready log's transcript to its day's journal per the rules in
 * journal-rules.ts, and records the outcome on the log. If the journal
 * changes underneath it (an edit saved mid-decision), the conditional
 * write fails and the decision is re-made against the new text, which
 * then almost always lands on `pending`.
 */
export async function applyTranscriptToJournal(id: string): Promise<void> {
  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const [log] = await db.select().from(videoLogs).where(eq(videoLogs.id, id)).limit(1);
    if (!log || log.status !== "ready") return;

    const [siblings, [day]] = await Promise.all([
      db
        .select({
          id: videoLogs.id,
          recordedAt: videoLogs.recordedAt,
          status: videoLogs.status,
          transcript: videoLogs.transcript,
        })
        .from(videoLogs)
        .where(and(eq(videoLogs.date, log.date), ne(videoLogs.id, log.id))),
      db.select({ journal: days.journal }).from(days).where(eq(days.date, log.date)).limit(1),
    ]);

    const decision = decideJournalAction({
      transcript: log.transcript,
      recordedAt: log.recordedAt,
      currentJournal: day?.journal ?? null,
      siblings,
    });

    switch (decision.kind) {
      case "none":
        return;
      case "superseded":
        await setOutcome(id, "superseded");
        return;
      case "pending":
        await setOutcome(id, "pending");
        // Latest wins for the prompt too: only the newest pending
        // transcript is offered, so older pending ones step aside.
        await supersedeOlderPending(log.date, log.recordedAt, id);
        return;
      case "apply": {
        const expected = decision.expected === "blank" ? "blank" : decision.expected.text;
        if (await compareAndSetJournal(log.date, expected, log.transcript!)) {
          await setOutcome(id, "applied");
          if (decision.expected !== "blank") await setOutcome(decision.expected.replacingId, "superseded");
          await supersedeOlderPending(log.date, log.recordedAt, id);
          return;
        }
        // The journal changed under us; decide again.
      }
    }
  }
  // Still racing after three tries: leave it for the user rather than
  // risk overwriting anything.
  await setOutcome(id, "pending");
}

async function supersedeOlderPending(date: string, recordedAt: Date, exceptId: string): Promise<void> {
  await getDb()
    .update(videoLogs)
    .set({ journalOutcome: "superseded", updatedAt: new Date() })
    .where(
      and(
        eq(videoLogs.date, date),
        eq(videoLogs.journalOutcome, "pending"),
        lt(videoLogs.recordedAt, recordedAt),
        ne(videoLogs.id, exceptId),
      ),
    );
}

/**
 * The user's Replace / Append / Keep for a transcript (#341's overwrite
 * confirmation). Allowed for any transcribed log, not just a pending one,
 * so a transcript that was kept or superseded can still be pulled into
 * the journal later. Returns the day's journal afterwards.
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
  const next = journalAfterChoice(choice, current, log.transcript!);

  if (choice !== "keep") {
    // And conditional at write time too, for an edit landing in between.
    const written = await compareAndSetJournal(log.date, isBlank(current) ? "blank" : current!, next!);
    if (!written) {
      throw new VideoLogError(409, "The journal changed since this page loaded. Reload and choose again.");
    }
  }

  const outcome = choice === "replace" ? "replaced" : choice === "append" ? "appended" : "kept";
  await setOutcome(id, outcome);
  await supersedeOlderPending(log.date, log.recordedAt, id);
  return choice === "keep" ? current : next;
}
