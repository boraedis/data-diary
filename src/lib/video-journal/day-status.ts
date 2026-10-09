// One line on the day summary's Journal card describing the day's video
// recordings (#342, epic #338), so the day page never looks empty or stale
// while a recording is on its way to the journal. Pure, for tests; the
// summary page feeds it rows from listVideoLogStatesForDate.
//
// Since #613, a recording only reaches the journal when the day is
// finalized, so the card's own done/not-done bar already follows the
// journal text. This line says what's happening with the video side:
// uploading, transcribing, failed, waiting to be finalized, or finalized.

import { TRANSCRIPTION_STALE_MS, type VideoLogStatus } from "@/lib/video-journal/video-log-types";

export type DayVideoRow = {
  status: VideoLogStatus;
  finalized: boolean;
  logNumber: number | null;
  transcriptionStartedAt: Date | null;
};

export type DayVideoNote = {
  text: string;
  /** error: needs a retry; attention: needs the user (finalize); progress:
   * still working; muted: settled. */
  tone: "error" | "attention" | "progress" | "muted";
};

/** A `transcribing` row this old was abandoned (its function died). Same
 * threshold the Record pane uses to offer Retry. */
export function isTranscriptionStale(row: Pick<DayVideoRow, "status" | "transcriptionStartedAt">, now: number): boolean {
  return (
    row.status === "transcribing" &&
    row.transcriptionStartedAt !== null &&
    now - row.transcriptionStartedAt.getTime() > TRANSCRIPTION_STALE_MS
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The most important thing to say, in order: something failed (it needs a
 * retry), something is still working, something needs finalizing, or the
 * day is settled. A day re-recorded after finalizing shows "to finalize"
 * rather than its old log number, because that's the action still open.
 */
export function summarizeDayVideo(rows: DayVideoRow[], now: number): DayVideoNote | null {
  if (rows.length === 0) return null;

  const failed = rows.filter((r) => r.status === "failed" || isTranscriptionStale(r, now)).length;
  if (failed > 0) {
    return { text: `${failed === 1 ? "Transcription failed" : `${failed} transcriptions failed`}. Retry in Record`, tone: "error" };
  }

  if (rows.some((r) => r.status === "uploading")) return { text: "Uploading video…", tone: "progress" };
  if (rows.some((r) => r.status === "uploaded" || r.status === "transcribing")) {
    return { text: "Transcribing…", tone: "progress" };
  }

  const unfinalized = rows.filter((r) => r.status === "ready" && !r.finalized).length;
  if (unfinalized > 0) return { text: `${plural(unfinalized, "recording")} to finalize`, tone: "attention" };

  const primary = rows.find((r) => r.finalized);
  if (primary) {
    return { text: primary.logNumber !== null ? `Video log #${primary.logNumber}` : "Video log", tone: "muted" };
  }
  return null;
}

/** summarizeDayVideo against the current time, for server pages. The clock
 * is read here rather than in the page because the React compiler's purity
 * lint rejects Date.now() in a component body, server components included,
 * even though a force-dynamic page renders once per request. */
export function summarizeDayVideoNow(rows: DayVideoRow[]): DayVideoNote | null {
  return summarizeDayVideo(rows, Date.now());
}
