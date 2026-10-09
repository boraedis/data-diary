import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  days,
  videoLogs,
  type VideoLogJournalOutcome as SchemaJournalOutcome,
  type VideoLogStatus as SchemaVideoLogStatus,
} from "@/db/schema";
import { isTranscriptionStale, type DayVideoRow } from "@/lib/video-journal/day-status";
import { buildJournalEntry } from "@/lib/video-journal/journal-entry";
import { extensionForMimeType } from "@/lib/video-journal/recording";
import { missingParts } from "@/lib/video-journal/upload-plan";
import {
  completeMultipartUpload,
  createMultipartUpload,
  getR2Config,
  headObject,
  listParts,
  presignGetObject,
  presignUploadPart,
  R2RequestError,
  type UploadedPart,
} from "@/lib/video-journal/r2";
import {
  type JournalOutcome,
  type PresignedPart,
  type StartUploadInput,
  type UploadState,
  type VideoLogStatus,
  type VideoLogSummary,
} from "@/lib/video-journal/video-log-types";

// Server-side lifecycle of a video log's upload (#339, epic #338): open an
// R2 multipart upload, hand the browser presigned part URLs, then verify
// and complete. The browser is never trusted about what arrived: resuming
// and completing both read R2's own ListParts.
//
// Transcription (#341) picks up rows once they reach `uploaded`.

// The client-safe unions in video-log-types.ts must match the DB enums.
// This fails to compile if either side gains or loses a value.
type SameStatuses = [VideoLogStatus] extends [SchemaVideoLogStatus]
  ? [SchemaVideoLogStatus] extends [VideoLogStatus]
    ? true
    : false
  : false;
export const VIDEO_LOG_STATUSES_MATCH: SameStatuses = true;
type SameOutcomes = [JournalOutcome] extends [SchemaJournalOutcome]
  ? [SchemaJournalOutcome] extends [JournalOutcome]
    ? true
    : false
  : false;
export const VIDEO_LOG_OUTCOMES_MATCH: SameOutcomes = true;

/** An API-mappable failure: `status` is the HTTP status the route returns. */
export class VideoLogError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Object key: grouped by diary day so the bucket browses sensibly in the
 * Cloudflare dashboard, and named by the log id so it's unique. */
export function storageKeyFor(date: string, id: string, mimeType: string): string {
  return `video-journal/${date}/${id}.${extensionForMimeType(mimeType)}`;
}

/** `video/mp4;codecs=…` → `video/mp4`. The codecs parameter is the
 * recorder's business; the stored object is served as the plain type,
 * which every player accepts. */
function contentTypeFor(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function isNoSuchUpload(error: unknown): boolean {
  return error instanceof R2RequestError && (error.code === "NoSuchUpload" || error.status === 404);
}

type VideoLogRow = typeof videoLogs.$inferSelect;

async function findRow(id: string): Promise<VideoLogRow | undefined> {
  const [row] = await getDb().select().from(videoLogs).where(eq(videoLogs.id, id)).limit(1);
  return row;
}

async function openUpload(row: Pick<VideoLogRow, "id" | "storageKey" | "mimeType">): Promise<string> {
  const uploadId = await createMultipartUpload(row.storageKey, contentTypeFor(row.mimeType));
  await getDb().update(videoLogs).set({ uploadId, updatedAt: new Date() }).where(eq(videoLogs.id, row.id));
  return uploadId;
}

/**
 * Starts an upload, or resumes the one already open for this id.
 * Idempotent: the device calls this every time it (re)tries, and gets back
 * the parts R2 already has so it only sends the rest.
 */
export async function startVideoLogUpload(input: StartUploadInput): Promise<UploadState> {
  const db = getDb();
  let row = await findRow(input.id);

  if (!row) {
    const storageKey = storageKeyFor(input.date, input.id, input.mimeType);
    // video_logs.date references days.date, and a recording can come
    // before anything else is logged that day.
    await db.insert(days).values({ date: input.date }).onConflictDoNothing();
    const uploadId = await createMultipartUpload(storageKey, contentTypeFor(input.mimeType));
    // A concurrent start for the same id (two tabs) loses this race
    // quietly and uses the winner's row; its own multipart upload is left
    // to R2's automatic cleanup of abandoned uploads.
    await db
      .insert(videoLogs)
      .values({
        id: input.id,
        date: input.date,
        status: "uploading",
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        durationMs: input.durationMs,
        recordedAt: new Date(input.recordedAt),
        recordedTz: input.recordedTz,
        uploadId,
      })
      .onConflictDoNothing();
    row = await findRow(input.id);
    if (!row) throw new VideoLogError(500, "Could not create the video log");
  }

  if (row.date !== input.date || row.sizeBytes !== input.sizeBytes) {
    // Same id, different recording. A UUID collision is practically
    // impossible, so this is a bug or a tampered request, never a retry.
    throw new VideoLogError(409, "A different recording already uses this id");
  }

  if (row.status !== "uploading") {
    return { id: row.id, status: row.status, sizeBytes: row.sizeBytes, uploadedParts: [] };
  }

  let uploadId = row.uploadId ?? (await openUpload(row));
  let parts: UploadedPart[];
  try {
    parts = await listParts(row.storageKey, uploadId);
  } catch (error) {
    // R2 aborts multipart uploads left incomplete for too long (7 days by
    // default). The device still has the file, so start over.
    if (!isNoSuchUpload(error)) throw error;
    uploadId = await openUpload(row);
    parts = [];
  }

  return {
    id: row.id,
    status: "uploading",
    sizeBytes: row.sizeBytes,
    uploadedParts: parts.map((p) => p.partNumber),
  };
}

/** The row an upload operation needs, or a 4xx explaining why not. */
async function openUploadRow(id: string): Promise<VideoLogRow & { uploadId: string }> {
  const row = await findRow(id);
  if (!row) throw new VideoLogError(404, "No such video log");
  if (row.status !== "uploading" || !row.uploadId) {
    throw new VideoLogError(409, "This recording isn't being uploaded");
  }
  return row as VideoLogRow & { uploadId: string };
}

export async function getVideoLogSize(id: string): Promise<number> {
  const row = await findRow(id);
  if (!row) throw new VideoLogError(404, "No such video log");
  return row.sizeBytes;
}

export async function presignVideoLogParts(id: string, partNumbers: number[]): Promise<PresignedPart[]> {
  const row = await openUploadRow(id);
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await presignUploadPart(row.storageKey, row.uploadId, partNumber),
    })),
  );
}

/**
 * Verifies R2 has every byte of the recording, completes the multipart
 * upload, re-checks the finished object's size, and marks the row
 * `uploaded`. Only after this returns does the device delete its local
 * copy, so any failure here leaves the recording safe on the device.
 */
export async function completeVideoLogUpload(id: string): Promise<VideoLogSummary> {
  const existing = await findRow(id);
  if (!existing) throw new VideoLogError(404, "No such video log");
  if (existing.status !== "uploading") return toSummary(existing);

  const row = await openUploadRow(id);
  let parts: UploadedPart[] | null = null;
  try {
    parts = await listParts(row.storageKey, row.uploadId);
  } catch (error) {
    // No upload under that id: a concurrent complete (another tab) may
    // have just finished it. The HEAD check below decides.
    if (!isNoSuchUpload(error)) throw error;
  }

  if (parts) {
    const missing = missingParts(row.sizeBytes, parts.map((p) => p.partNumber));
    if (missing.length > 0) {
      throw new VideoLogError(409, `Upload incomplete: missing part(s) ${missing.join(", ")}`);
    }
    const received = parts.reduce((sum, p) => sum + p.size, 0);
    if (received !== row.sizeBytes) {
      throw new VideoLogError(409, `Upload size mismatch: expected ${row.sizeBytes} bytes, R2 has ${received}`);
    }
    await completeMultipartUpload(row.storageKey, row.uploadId, parts);
  }

  const stored = await headObject(row.storageKey);
  if (!stored || stored.size !== row.sizeBytes) {
    throw new VideoLogError(
      502,
      stored
        ? `Stored object is ${stored.size} bytes, expected ${row.sizeBytes}`
        : "The upload didn't produce a stored object",
    );
  }

  await getDb()
    .update(videoLogs)
    .set({ status: "uploaded", uploadId: null, uploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoLogs.id, id));
  const done = await findRow(id);
  return toSummary(done!);
}

/**
 * Gives a log the next "Video log #N" if it doesn't have one yet (called
 * by Finalize, #613, for the chosen recording), and
 * returns its number. Idempotent. The number is computed and set in one
 * statement; if two logs finish at the same instant and pick the same N,
 * the unique index rejects one and it simply tries again.
 */
export async function assignLogNumber(id: string): Promise<number | null> {
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db
        .update(videoLogs)
        .set({ logNumber: sql`(SELECT coalesce(max(${videoLogs.logNumber}), 0) + 1 FROM ${videoLogs})` })
        .where(and(eq(videoLogs.id, id), isNull(videoLogs.logNumber)));
      break;
    } catch (error) {
      // 23505 = unique_violation: lost the race for this number.
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (code !== "23505" || attempt === 4) throw error;
    }
  }
  const [row] = await db.select({ logNumber: videoLogs.logNumber }).from(videoLogs).where(eq(videoLogs.id, id)).limit(1);
  return row?.logNumber ?? null;
}

async function toSummary(row: VideoLogRow): Promise<VideoLogSummary> {
  const playable = row.status !== "uploading" && getR2Config() !== null;
  return {
    id: row.id,
    date: row.date,
    status: row.status,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    recordedAt: row.recordedAt.toISOString(),
    logNumber: row.logNumber,
    finalized: row.finalizedAt !== null,
    playbackUrl: playable ? await presignGetObject(row.storageKey) : null,
    transcript: row.transcript,
    transcriptionError: row.transcriptionError,
    journalOutcome: row.journalOutcome,
    // What a Replace/Append would write: the stored block if this log has
    // already written one, otherwise a fresh render.
    journalEntry:
      row.status === "ready" && row.transcript?.trim()
        ? (row.journalEntry ??
          buildJournalEntry({
            id: row.id,
            logNumber: row.logNumber,
            recordedAt: row.recordedAt,
            recordedTz: row.recordedTz,
            durationMs: row.durationMs,
            transcript: row.transcript,
          }))
        : null,
    transcriptionStale: isTranscriptionStale(row, Date.now()),
  };
}

/** A day's recordings, oldest first (the order they were made in), with
 * fresh playback URLs. */
export async function listVideoLogsForDate(date: string): Promise<VideoLogSummary[]> {
  const rows = await getDb()
    .select()
    .from(videoLogs)
    .where(eq(videoLogs.date, date))
    .orderBy(asc(videoLogs.recordedAt));
  return Promise.all(rows.map(toSummary));
}

/** Just enough about a day's recordings for the day summary's status line
 * (#342, day-status.ts). No presigned URLs or transcripts: the summary
 * page doesn't play anything, it links to the Journal section that does. */
export async function listVideoLogStatesForDate(date: string): Promise<DayVideoRow[]> {
  return getDb()
    .select({
      status: videoLogs.status,
      finalized: sql<boolean>`${videoLogs.finalizedAt} IS NOT NULL`,
      logNumber: videoLogs.logNumber,
      transcriptionStartedAt: videoLogs.transcriptionStartedAt,
    })
    .from(videoLogs)
    .where(eq(videoLogs.date, date))
    .orderBy(asc(videoLogs.recordedAt));
}
