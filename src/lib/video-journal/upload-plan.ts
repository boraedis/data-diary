// How a recording is cut into multipart-upload parts (#339). Shared by
// the browser uploader (which slices the file) and the server (which
// checks R2 received every part before completing), so both sides agree
// on the part count for a given size. Pure, so it runs and tests anywhere.
//
// Uploads go straight from the browser to R2 via presigned part URLs.
// Proxying through an API route isn't an option: Vercel caps a request
// body at 4.5MB, and R2 rejects any part but the last below 5MiB.

/**
 * Bytes per part. R2's rules: every part except the last must be at least
 * 5MiB, and unlike S3, every part except the last must be the *same*
 * size, so this is a single fixed value rather than adaptive. 10MiB keeps
 * a dropped connection's retry cheap on a phone (one part is re-sent, not
 * the file) while a 30-minute take is only ~25 parts. With R2's 10,000-
 * part limit it allows files up to ~100GB, far beyond any recording.
 */
export const UPLOAD_PART_SIZE = 10 * 1024 * 1024;

/** R2/S3's hard limit on parts per upload. */
export const MAX_UPLOAD_PARTS = 10_000;

/** Largest recording the API will accept. A guard against garbage input,
 * not a product limit: 20GB is many hours at the recorder's bitrate. */
export const MAX_RECORDING_BYTES = 20 * 1000 * 1000 * 1000;

/** Number of parts a file of `sizeBytes` is split into. An empty file is
 * still one (empty) part, since a multipart upload needs at least one. */
export function partCount(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / UPLOAD_PART_SIZE));
}

/** Byte range `[start, end)` of 1-based `partNumber`, for `Blob.slice`. */
export function partRange(partNumber: number, sizeBytes: number): [number, number] {
  const start = (partNumber - 1) * UPLOAD_PART_SIZE;
  return [start, Math.min(start + UPLOAD_PART_SIZE, sizeBytes)];
}

/** Part numbers still to send, given the ones R2 already has. */
export function missingParts(sizeBytes: number, uploaded: Iterable<number>): number[] {
  const have = new Set(uploaded);
  const missing: number[] = [];
  for (let n = 1; n <= partCount(sizeBytes); n++) {
    if (!have.has(n)) missing.push(n);
  }
  return missing;
}
