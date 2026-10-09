"use client";

import { Button } from "@/components/ui/button";
import { formatBytes, formatElapsed } from "@/lib/video-journal/recording";
import type { VideoLogStatus, VideoLogSummary } from "@/lib/video-journal/video-log-types";

// The day's recordings that live in R2 (#339): listed from the
// `video_logs` table by the server page and played from short-lived
// presigned URLs. Kept deliberately plain. The day summary page's links
// and richer in-progress states are #342, and transcripts are #341.

const STATUS_LABEL: Record<VideoLogStatus, string> = {
  // Only reachable if the device that started it is still mid-upload, or
  // gave up. Its local copy is what finishes it.
  uploading: "Uploading from a device",
  uploaded: "Stored",
  transcribing: "Transcribing…",
  ready: "Transcribed",
  failed: "Transcription failed",
};

export function StoredRecordings({
  recordings,
  playingId,
  onPlay,
}: {
  recordings: VideoLogSummary[];
  playingId: string | null;
  onPlay: (log: VideoLogSummary) => void;
}) {
  if (recordings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Recordings</h3>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {recordings.map((log) => (
          <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex flex-col">
              <span className="font-mono text-sm">
                {new Date(log.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
                {formatElapsed(log.durationMs)} · {formatBytes(log.sizeBytes)}
              </span>
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[log.status]}</span>
            </div>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
