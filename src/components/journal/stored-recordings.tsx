"use client";

import { Button } from "@/components/ui/button";
import { formatBytes, formatElapsed } from "@/lib/video-journal/recording";
import type { JournalOutcome, VideoLogSummary } from "@/lib/video-journal/video-log-types";

// The day's recordings that live in R2 (#339): listed from the
// `video_logs` table by the server page and played from short-lived
// presigned URLs. Each one shows where its transcript is (#341) and what
// it did to the journal. The day summary page's links and states are #342.

/** One line on what a transcript did to the journal. */
const OUTCOME_NOTE: Record<JournalOutcome, string> = {
  applied: "In the journal",
  pending: "Waiting for your choice",
  replaced: "Replaced the journal text",
  appended: "Added below the journal text",
  kept: "Not used in the journal (kept here)",
  superseded: "A newer recording's transcript is in the journal",
};

function statusLine(log: VideoLogSummary, transcriptionNotConfigured: boolean): { text: string; tone: "muted" | "error" } {
  switch (log.status) {
    // Only reachable if the device that started it is still mid-upload or
    // gave up. Its local copy is what finishes it.
    case "uploading":
      return { text: "Uploading from a device", tone: "muted" };
    case "uploaded":
      return {
        text: transcriptionNotConfigured ? "Stored. Transcription isn't set up yet" : "Stored. Waiting to transcribe…",
        tone: "muted",
      };
    case "transcribing":
      return log.transcriptionStale
        ? { text: "Transcription stalled", tone: "error" }
        : { text: "Transcribing…", tone: "muted" };
    case "ready":
      if (!log.transcript?.trim()) return { text: "Transcribed. No speech found", tone: "muted" };
      // Transcripts wait for Finalize (#613) to reach the journal.
      return {
        text: log.journalOutcome ? OUTCOME_NOTE[log.journalOutcome] : "Transcribed. Not in the journal until you finalize",
        tone: "muted",
      };
    case "failed":
      return {
        text: `Transcription failed${log.transcriptionError ? `: ${log.transcriptionError}` : ""}. The journal wasn't changed.`,
        tone: "error",
      };
  }
}

export function StoredRecordings({
  recordings,
  playingId,
  onPlay,
  onRetryTranscription,
  transcriptionNotConfigured,
}: {
  recordings: VideoLogSummary[];
  playingId: string | null;
  onPlay: (log: VideoLogSummary) => void;
  onRetryTranscription: (id: string) => void;
  transcriptionNotConfigured: boolean;
}) {
  if (recordings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Recordings</h3>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {recordings.map((log) => {
          const status = statusLine(log, transcriptionNotConfigured);
          const canRetry = log.status === "failed" || (log.status === "transcribing" && log.transcriptionStale);
          return (
            <li key={log.id} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="font-mono text-sm">
                    {log.logNumber !== null ? `#${log.logNumber} · ` : ""}
                    {new Date(log.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
                    {formatElapsed(log.durationMs)} · {formatBytes(log.sizeBytes)}
                  </span>
                  <span className={status.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                    {status.text}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {canRetry ? (
                    <Button type="button" size="sm" onClick={() => onRetryTranscription(log.id)}>
                      Retry transcription
                    </Button>
                  ) : null}
                  {log.playbackUrl ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={playingId === log.id ? "secondary" : "outline"}
                      onClick={() => onPlay(log)}
                    >
                      {playingId === log.id ? "Playing" : "Play"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {log.status === "ready" && log.transcript?.trim() ? (
                <details className="text-sm">
                  <summary className="cursor-pointer select-none text-xs text-muted-foreground">Transcript</summary>
                  <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">{log.transcript}</p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
