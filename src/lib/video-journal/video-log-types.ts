// Shapes and validation shared by the video-log API routes and the browser
// uploader (#339). Free of DB and R2 imports so client code can use it.

import { isValidDateString } from "@/lib/date";
import { sanitizeHudSnapshot, type HudDiaryStats, type HudSnapshot } from "@/lib/video-journal/hud";
import { MAX_RECORDING_BYTES, MAX_UPLOAD_PARTS, partCount } from "@/lib/video-journal/upload-plan";

export type VideoLogStatus = "uploading" | "uploaded" | "transcribing" | "ready" | "failed";

/** What the device tells the server when it starts (or resumes) an upload.
 * `id` is the recording's local IndexedDB id, which makes starting
 * idempotent. */
export type StartUploadInput = {
  id: string;
  date: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  recordedAt: string;
  /** The device's IANA timezone, for the journal header's local time.
   * Null when the device didn't report one. */
  recordedTz: string | null;
  /** The mission HUD's conditions at record time (#599). */
  hud: HudSnapshot | null;
};

/** Where an upload stands, from R2's point of view. `uploadedParts` comes
 * from R2's ListParts, so a resumed upload only sends what's missing. */
export type UploadState = {
  id: string;
  status: VideoLogStatus;
  sizeBytes: number;
  uploadedParts: number[];
};

export type PresignedPart = { partNumber: number; url: string };

/** See transcription.ts's journal-outcome notes and the schema enum. */
export type JournalOutcome = "applied" | "pending" | "replaced" | "appended" | "kept" | "superseded";

/** A `transcribing` log whose attempt started longer ago than this was
 * abandoned (the function running it was killed) and may be retried. Well
 * past the transcription route's 300s budget, so a live attempt is never
 * mistaken for a dead one. Shared so the UI and server agree on when to
 * offer Retry. */
export const TRANSCRIPTION_STALE_MS = 15 * 60 * 1000;

/** A stored recording as the Journal section lists it. `playbackUrl` is a
 * presigned GET valid for an hour, or null while still uploading (or if R2
 * isn't configured on this deployment). */
export type VideoLogSummary = {
  id: string;
  date: string;
  status: VideoLogStatus;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  recordedAt: string;
  /** "Video log #N", once assigned (at Finalize, #613). */
  logNumber: number | null;
  /** True for the recording chosen as the day's primary at Finalize. */
  finalized: boolean;
  /** Conditions at record time, for the playback HUD (#599). */
  hud: HudSnapshot | null;
  playbackUrl: string | null;
  /** #341. Null until transcribed; "" when no speech was found. */
  transcript: string | null;
  transcriptionError: string | null;
  journalOutcome: JournalOutcome | null;
  /** The header + transcript block this log puts in the journal, for the
   * Replace/Append prompt's preview. Null until there's a transcript. */
  journalEntry: string | null;
  /** True for a `transcribing` log that's been at it long enough to count
   * as abandoned, so the UI offers Retry instead of waiting forever. */
  transcriptionStale: boolean;
};

/** A day's finalized video log as /journal plays it inline (#619). */
export type JournalVideo = {
  id: string;
  date: string;
  logNumber: number | null;
  recordedAt: string;
  /** Presigned GET, valid for an hour; null if R2 isn't configured here. */
  playbackUrl: string | null;
  hud: HudSnapshot | null;
  /** That day's diary numbers, read now (#599's live split). */
  stats: HudDiaryStats;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the two containers the recorder can produce. The type ends up as
 * the stored object's Content-Type, so it shouldn't be arbitrary text. */
const ALLOWED_MIME = /^video\/(mp4|webm)(\s*;[\w\s.,=+-]*)?$/i;

export function isVideoLogId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function validateStartUpload(body: unknown): Result<StartUploadInput> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request body" };
  const b = body as Record<string, unknown>;

  if (!isVideoLogId(b.id)) return { ok: false, error: "id must be a UUID" };
  if (typeof b.date !== "string" || !isValidDateString(b.date)) return { ok: false, error: "Invalid date" };
  if (typeof b.mimeType !== "string" || !ALLOWED_MIME.test(b.mimeType)) {
    return { ok: false, error: "mimeType must be video/mp4 or video/webm" };
  }
  if (typeof b.sizeBytes !== "number" || !Number.isInteger(b.sizeBytes) || b.sizeBytes <= 0) {
    return { ok: false, error: "sizeBytes must be a positive integer" };
  }
  if (b.sizeBytes > MAX_RECORDING_BYTES || partCount(b.sizeBytes) > MAX_UPLOAD_PARTS) {
    return { ok: false, error: "Recording is too large" };
  }
  if (typeof b.durationMs !== "number" || !Number.isInteger(b.durationMs) || b.durationMs < 0) {
    return { ok: false, error: "durationMs must be a non-negative integer" };
  }
  if (typeof b.recordedAt !== "string" || Number.isNaN(Date.parse(b.recordedAt))) {
    return { ok: false, error: "recordedAt must be an ISO timestamp" };
  }

  // Optional, and a bad value is dropped rather than rejected: the
  // timezone only affects how the journal header prints the time, which
  // falls back to UTC.
  const recordedTz = typeof b.recordedTz === "string" && isValidTimeZone(b.recordedTz) ? b.recordedTz : null;

  return {
    ok: true,
    value: {
      recordedTz,
      // Same leniency as the timezone: a garbled snapshot is dropped,
      // never a reason to refuse the recording.
      hud: sanitizeHudSnapshot(b.hud),
      id: b.id.toLowerCase(),
      date: b.date,
      mimeType: b.mimeType,
      sizeBytes: b.sizeBytes,
      durationMs: b.durationMs,
      recordedAt: new Date(b.recordedAt).toISOString(),
    },
  };
}

function isValidTimeZone(tz: string): boolean {
  if (tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Part numbers to presign: a non-empty list of distinct in-range
 * integers, at most 100 per request so one call can't mint thousands of
 * URLs. */
export function validatePartNumbers(body: unknown, sizeBytes: number): Result<number[]> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request body" };
  const raw = (body as Record<string, unknown>).partNumbers;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    return { ok: false, error: "partNumbers must be a list of 1–100 part numbers" };
  }
  const max = partCount(sizeBytes);
  const numbers = new Set<number>();
  for (const n of raw) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max) {
      return { ok: false, error: `Part numbers must be between 1 and ${max}` };
    }
    numbers.add(n);
  }
  return { ok: true, value: [...numbers].sort((a, b) => a - b) };
}
