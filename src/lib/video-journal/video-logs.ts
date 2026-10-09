import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days, videoLogs, type VideoLogStatus as SchemaVideoLogStatus } from "@/db/schema";
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
import type {
  PresignedPart,
  StartUploadInput,
  UploadState,
  VideoLogStatus,
  VideoLogSummary,
} from "@/lib/video-journal/video-log-types";

// Server-side lifecycle of a video log's upload (#339, epic #338): open an
// R2 multipart upload, hand the browser presigned part URLs, then verify
// and complete. The browser is never trusted about what arrived: resuming
// and completing both read R2's own ListParts.
//
// Transcription (#341) picks up rows once they reach `uploaded`.

// The client-safe union in video-log-types.ts must match the DB enum.
// This fails to compile if either side gains or loses a value.
type SameStatuses = [VideoLogStatus] extends [SchemaVideoLogStatus]
  ? [SchemaVideoLogStatus] extends [VideoLogStatus]
    ? true
    : false
  : false;
export const VIDEO_LOG_STATUSES_MATCH: SameStatuses = true;

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

  const [updated] = await getDb()
    .update(videoLogs)
    .set({ status: "uploaded", uploadId: null, uploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoLogs.id, id))
    .returning();
  return toSummary(updated);
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
    playbackUrl: playable ? await presignGetObject(row.storageKey) : null,
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
