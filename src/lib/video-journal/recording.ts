// Pure, browser-API-free pieces of the video journal recorder (#340, epic
// #338). The component in src/components/journal/video-recorder.tsx owns
// the MediaRecorder/getUserMedia side; everything here takes plain values
// in so it can be unit-tested without a browser.

/**
 * Container/codec preference, most preferred first. Fed to
 * `MediaRecorder.isTypeSupported` and the first hit wins.
 *
 * MP4 (H.264 + AAC) comes first everywhere it's available, not just on
 * Safari:
 * - iPhone Safari, the device to prove first per #340's test matrix, only
 *   records MP4, so MP4 is the format every recording can be in.
 * - Chrome's WebM output has no duration or seek index (cues). That's
 *   harmless for a 2-minute clip but makes a 30-minute log painful to
 *   scrub, and recordings are explicitly allowed to run long (#338,
 *   2026-10-08 decisions). Chrome has recorded MP4 since ~v126.
 * - H.264/AAC plays back on every browser this app targets; WebM still
 *   has gaps on Apple devices.
 * WebM stays as a fallback so an older Chrome can still record rather
 * than refusing outright.
 */
export const RECORDING_MIME_PREFERENCES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function pickRecordingMimeType(isTypeSupported: (mimeType: string) => boolean): string | null {
  for (const mimeType of RECORDING_MIME_PREFERENCES) {
    try {
      if (isTypeSupported(mimeType)) return mimeType;
    } catch {
      // Some engines throw on a codecs string they can't parse instead of
      // returning false; treat that as "not supported" and keep going.
    }
  }
  return null;
}

/** File extension for a recorded blob's MIME type, for downloads now and
 * the R2 object key later (#339). Anything that isn't WebM is treated as
 * MP4. Safari reports plain `video/mp4`, and the codecs suffix doesn't
 * matter for the extension. */
export function extensionForMimeType(mimeType: string): "mp4" | "webm" {
  return mimeType.toLowerCase().startsWith("video/webm") ? "webm" : "mp4";
}

/**
 * Target encoder bitrates. 720p at ~1 Mbps is the proposed default from
 * #338's 2026-10-08 comment (about 7.5MB per minute, roughly 270GB a
 * decade at 10 min/day). It's still marked "to confirm" there, which is
 * why it's one constant rather than scattered literals. Browsers treat
 * these as hints; the recorder's details panel shows the bitrate a device
 * actually produced.
 */
export const VIDEO_BITS_PER_SECOND = 1_000_000;
export const AUDIO_BITS_PER_SECOND = 96_000;

/**
 * How often MediaRecorder hands over a chunk while recording. Each chunk
 * is written to IndexedDB as it arrives (src/lib/video-journal/
 * local-store.ts), so this is also the most a crashed tab or a killed
 * camera can lose. #339 will batch these into ≥5MB multipart-upload
 * parts, so they don't need to be big themselves.
 */
export const RECORDING_TIMESLICE_MS = 1000;

/** Camera/mic request. Front camera at a 720p *ideal*, never exact: an
 * exact constraint a device can't meet fails the whole request, while an
 * ideal one just gets the nearest mode. A phone held upright gets a
 * portrait stream either way. Echo cancellation and noise suppression are
 * on because this is speech meant for transcription (#341), not music. */
export const CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
  },
};

/** "0:07", "12:34", "1:02:03". Recordings can run past an hour, so hours
 * appear when needed rather than minutes overflowing to "62:03". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** "840 KB", "12.4 MB", "1.21 GB". Decimal units, matching how browsers
 * and storage providers (R2 included) report sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/** Effective bitrate of a finished recording, in Mbps, or null when it's
 * too short to say anything meaningful. Shown in the details panel so a
 * device test can report what the encoder actually did with
 * VIDEO_BITS_PER_SECOND. */
export function effectiveMbps(bytes: number, durationMs: number): number | null {
  if (durationMs < 1000) return null;
  return (bytes * 8) / (durationMs / 1000) / 1_000_000;
}

export type RecorderErrorKind = "permission" | "no-device" | "in-use" | "unsupported" | "insecure" | "unknown";

/** Maps a getUserMedia/MediaRecorder failure to something the UI can give
 * specific advice for. The DOMException names are the spec'd ones; Safari
 * and Chrome both use them. */
export function classifyRecorderError(error: unknown): RecorderErrorKind {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no-device";
    case "NotReadableError":
    case "AbortError":
      return "in-use";
    case "NotSupportedError":
      return "unsupported";
    default:
      return "unknown";
  }
}
