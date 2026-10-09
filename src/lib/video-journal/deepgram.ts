// Server-only Deepgram client for video journal transcription (#341, epic
// #338). Never import this from a client component: it reads the API key.
//
// Why Deepgram (decided on #338, 2026-10-08, and recorded on #341):
// recordings can run long (tens of minutes), so the service has to take
// big files without us shuffling bytes around. Deepgram fetches the video
// itself from a presigned R2 URL, accepts video containers directly (no
// audio extraction step), handles multi-hour files, and returns word
// timestamps, which are kept for future "jump to this moment" search.
// OpenAI's transcription API was ruled out by its 25MB upload limit.
// AssemblyAI is the fallback if this ever needs replacing.
//
// One synchronous request per recording. Deepgram's pre-recorded API
// processes far faster than real time, so even a long log comes back
// within the route's time budget. That avoids a callback URL, which would
// be a new unauthenticated endpoint in src/proxy.ts.

export function getDeepgramKey(): string | null {
  return process.env.DEEPGRAM_API_KEY || null;
}

export class TranscriptionNotConfiguredError extends Error {
  constructor() {
    super("Transcription is not configured: set DEEPGRAM_API_KEY");
  }
}

/** Deepgram's current general-purpose model when #341 was built. Pinned
 * rather than "latest" so a model change is a deliberate code change. */
export const DEEPGRAM_MODEL = "nova-3";

/**
 * - smart_format: punctuation, capitalisation, numerals, so the transcript
 *   reads as a journal entry rather than a word stream.
 * - paragraphs: breaks on pauses and topic shifts; the journal keeps them.
 * - detect_language: the dominant language is detected per recording,
 *   rather than assuming English for every log.
 */
const LISTEN_PARAMS = new URLSearchParams({
  model: DEEPGRAM_MODEL,
  smart_format: "true",
  paragraphs: "true",
  detect_language: "true",
});

/** Comfortably inside the route's 300s budget, leaving time to save the
 * result. Past this, the attempt is marked failed and can be retried. */
const REQUEST_TIMEOUT_MS = 270_000;

export type TranscriptionResult = {
  /** Paragraph-broken text; "" when no speech was found. */
  transcript: string;
  /** [startSeconds, endSeconds, word] tuples. */
  words: [number, number, string][];
  language: string | null;
};

type DeepgramWord = { word?: string; punctuated_word?: string; start?: number; end?: number };
type DeepgramAlternative = {
  transcript?: string;
  paragraphs?: { transcript?: string };
  words?: DeepgramWord[];
};
type DeepgramResponse = {
  results?: { channels?: { detected_language?: string; alternatives?: DeepgramAlternative[] }[] };
};

/** Pulls what we store out of Deepgram's response. Pure, for tests. */
export function parseDeepgramResponse(body: unknown): TranscriptionResult {
  const channel = (body as DeepgramResponse)?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  if (!alt) throw new Error("Deepgram returned no transcription results");

  // The paragraphs transcript carries the paragraph breaks; it starts with
  // a newline, and runs of blank lines are collapsed to one.
  const transcript = (alt.paragraphs?.transcript ?? alt.transcript ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const words: [number, number, string][] = (alt.words ?? [])
    .filter((w) => typeof w.start === "number" && typeof w.end === "number")
    .map((w) => [round2(w.start!), round2(w.end!), w.punctuated_word ?? w.word ?? ""]);

  return { transcript, words, language: channel?.detected_language ?? null };
}

/** Centisecond precision is plenty for seeking, and keeps the stored
 * word list small. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Transcribes the media at `mediaUrl`, which Deepgram fetches itself. */
export async function transcribeUrl(mediaUrl: string): Promise<TranscriptionResult> {
  const key = getDeepgramKey();
  if (!key) throw new TranscriptionNotConfiguredError();

  const res = await fetch(`https://api.deepgram.com/v1/listen?${LISTEN_PARAMS}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: mediaUrl }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const reason =
      (body && typeof body === "object" && ("err_msg" in body ? body.err_msg : "message" in body ? body.message : null)) ||
      res.statusText;
    throw new Error(`Deepgram request failed (${res.status}): ${String(reason)}`);
  }
  return parseDeepgramResponse(body);
}
