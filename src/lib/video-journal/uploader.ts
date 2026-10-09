// Browser side of the R2 upload (#339, epic #338): sends one recording to
// R2 in fixed-size parts via presigned URLs, then asks the server to
// verify and complete it.
//
// Resumable by construction. Every attempt starts by asking the server
// which parts R2 already has (`POST /api/video-logs`, idempotent on the
// recording id) and only sends the rest. A dropped connection, a closed
// tab or a dead battery costs at most the part that was in flight, as long
// as the device still has its local copy, which it keeps until the
// complete call succeeds.

import { missingParts, partRange } from "@/lib/video-journal/upload-plan";
import type { PresignedPart, UploadState, VideoLogSummary } from "@/lib/video-journal/video-log-types";

export type UploadSource = {
  id: string;
  date: string;
  mimeType: string;
  durationMs: number;
  /** ISO timestamp. */
  recordedAt: string;
  /** IANA timezone of the recording device, if known. */
  recordedTz: string | null;
  blob: Blob;
};

export type UploadProgress = { sentBytes: number; totalBytes: number };

/** The deployment has no R2 config (503). Not a failure of this
 * recording: it stays on the device until storage exists. */
export class UploadNotConfiguredError extends Error {
  constructor() {
    super("Video storage isn't set up on this deployment yet");
  }
}

export class UploadError extends Error {}

/** Parts in flight at once. Three keeps a phone's uplink busy without
 * one slow part starving the rest. */
const PART_CONCURRENCY = 3;
/** Presigned URLs fetched per request (server cap is 100). */
const PRESIGN_BATCH = 20;
const MAX_ATTEMPTS = 4;

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 503) throw new UploadNotConfiguredError();
  // An expired session doesn't get a 401: src/proxy.ts redirects every
  // non-public path to /login, and fetch follows that to a 200 HTML page.
  if (res.redirected && new URL(res.url).pathname === "/login") {
    throw Object.assign(new UploadError("Signed out. Sign in again and the upload will resume"), { retryable: false });
  }
  const json = await res.json().catch(() => null);
  if (res.ok && json === null) {
    throw Object.assign(new UploadError(`Unexpected response from ${url}`), { retryable: true });
  }
  if (!res.ok) {
    const message = typeof json?.error === "string" ? json.error : `Request failed (${res.status})`;
    // 4xx is a definite "no" that retrying won't change; 5xx might.
    throw Object.assign(new UploadError(message), { retryable: res.status >= 500 });
  }
  return json as T;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof UploadNotConfiguredError) return false;
  if (error instanceof UploadError) return (error as UploadError & { retryable?: boolean }).retryable !== false;
  // fetch() rejects with a TypeError on network failure: worth retrying.
  return true;
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      // 1s, 2s, 4s: long enough to ride out a tunnel or a Wi-Fi handoff.
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function putPart(url: string, body: Blob, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "PUT", body, signal });
  if (!res.ok) {
    // 403 here almost always means an expired URL or a missing bucket
    // CORS rule; both are retried by re-presigning in the next attempt
    // rather than reusing this URL.
    throw Object.assign(new UploadError(`R2 rejected part upload (${res.status})`), {
      retryable: res.status >= 500 || res.status === 403 || res.status === 408,
    });
  }
}

/**
 * Uploads `source` and returns the stored log. If the server says the
 * recording is already stored (an earlier attempt completed but the device
 * never heard back), that counts as success too.
 */
export async function uploadRecording(
  source: UploadSource,
  { onProgress, signal }: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<VideoLogSummary | UploadState> {
  const { blob } = source;
  const total = blob.size;

  const state = await withRetry(
    () =>
      postJson<UploadState>("/api/video-logs", {
        id: source.id,
        date: source.date,
        mimeType: source.mimeType,
        sizeBytes: total,
        durationMs: Math.round(source.durationMs),
        recordedAt: source.recordedAt,
        recordedTz: source.recordedTz,
      }),
    signal,
  );
  if (state.status !== "uploading") return state;

  const todo = missingParts(total, state.uploadedParts);
  let sent = state.uploadedParts.reduce((sum, n) => {
    const [start, end] = partRange(n, total);
    return sum + (end - start);
  }, 0);
  onProgress?.({ sentBytes: sent, totalBytes: total });

  for (let i = 0; i < todo.length; i += PRESIGN_BATCH) {
    const batch = todo.slice(i, i + PRESIGN_BATCH);
    const queue = [...batch];
    let urls = new Map<number, string>();
    const presign = async () => {
      const { parts } = await withRetry(
        () => postJson<{ parts: PresignedPart[] }>(`/api/video-logs/${source.id}/parts`, { partNumbers: batch }),
        signal,
      );
      urls = new Map(parts.map((p) => [p.partNumber, p.url]));
    };
    await presign();

    const worker = async () => {
      for (let partNumber = queue.shift(); partNumber !== undefined; partNumber = queue.shift()) {
        const [start, end] = partRange(partNumber, total);
        const n = partNumber;
        await withRetry(async () => {
          try {
            await putPart(urls.get(n)!, blob.slice(start, end), signal);
          } catch (error) {
            // Fresh URLs before the retry, in case these expired.
            if (error instanceof UploadError) await presign().catch(() => {});
            throw error;
          }
        }, signal);
        sent += end - start;
        onProgress?.({ sentBytes: sent, totalBytes: total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, batch.length) }, worker));
  }

  return withRetry(() => postJson<VideoLogSummary>(`/api/video-logs/${source.id}/complete`), signal);
}
