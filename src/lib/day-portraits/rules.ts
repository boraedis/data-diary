// Pure rules for day portraits (#622, #688). No server or browser imports,
// so the capture card, the API route and the tests all share one definition
// of what counts as a valid portrait.

export const PORTRAIT_MIME_TYPES = ["image/jpeg", "image/webp"] as const;
export type PortraitMimeType = (typeof PORTRAIT_MIME_TYPES)[number];

/** Vercel Functions reject request bodies over 4.5MB, so the cap sits under
 * that. A 2048px JPEG at quality 0.92 is well under 1MB, so this only
 * ever bites if something other than the capture card is posting. */
export const MAX_PORTRAIT_BYTES = 4 * 1024 * 1024;

/** Longest side of a saved portrait. Webcams can report 4K; the facelapse
 * is rendered at 720p, so there's nothing to gain from storing more than
 * this, and the smaller file is what lets the server take the upload
 * directly rather than via presigned multipart. */
export const PORTRAIT_MAX_EDGE_PX = 2048;

export const PORTRAIT_JPEG_QUALITY = 0.92;

export function isPortraitMimeType(value: string): value is PortraitMimeType {
  return (PORTRAIT_MIME_TYPES as readonly string[]).includes(value);
}

export function portraitExtension(mimeType: PortraitMimeType): string {
  return mimeType === "image/webp" ? "webp" : "jpg";
}

/** "day-portraits/2026-10-29/<id>.jpg": grouped by diary day so the bucket
 * browses sensibly in the Cloudflare dashboard, like the video journal's
 * keys. `id` is fresh per upload (see the schema comment on retakes). */
export function portraitStorageKey(date: string, id: string, mimeType: PortraitMimeType): string {
  return `day-portraits/${date}/${id}.${portraitExtension(mimeType)}`;
}

/** What the bytes actually are, from their magic numbers. The declared
 * Content-Type is what R2 will serve the object as, so it must not be taken
 * on trust. */
export function sniffImageType(bytes: Uint8Array): PortraitMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type PortraitUploadCheck =
  | { ok: true; mimeType: PortraitMimeType }
  | { ok: false; status: number; error: string };

/** Validates an upload's declared type and size, and, once the bytes are in
 * hand, that they match the declared type. Pass `bytes` as null for the
 * early check on headers alone. */
export function validatePortraitUpload(input: {
  contentType: string | null;
  sizeBytes: number | null;
  bytes: Uint8Array | null;
}): PortraitUploadCheck {
  // "image/jpeg; charset=…" → "image/jpeg"
  const declared = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!isPortraitMimeType(declared)) {
    return { ok: false, status: 415, error: "A portrait must be a JPEG or WebP image" };
  }
  if (input.sizeBytes !== null) {
    if (input.sizeBytes <= 0) return { ok: false, status: 400, error: "The photo is empty" };
    if (input.sizeBytes > MAX_PORTRAIT_BYTES) {
      return { ok: false, status: 413, error: "The photo is too large" };
    }
  }
  if (input.bytes) {
    if (sniffImageType(input.bytes) !== declared) {
      return { ok: false, status: 415, error: "The photo's contents don't match its type" };
    }
  }
  return { ok: true, mimeType: declared };
}

/** Scales (width, height) down so the longer side is at most `maxEdge`,
 * keeping the aspect ratio. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A day's saved portrait as the page and the API hand it around. `url` is
 * a short-lived presigned GET: it expires within the hour, so it is minted
 * per request and never stored. */
export type DayPortrait = {
  date: string;
  url: string;
  capturedAt: string;
  sizeBytes: number;
};
