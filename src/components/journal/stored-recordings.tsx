"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { FinalizeResult } from "@/lib/video-journal/finalize";
import type { JournalChoice } from "@/lib/video-journal/journal-rules";
import { formatBytes, formatElapsed } from "@/lib/video-journal/recording";
import type { JournalOutcome, VideoLogSummary } from "@/lib/video-journal/video-log-types";

// The day's recordings that live in R2 (#339), each with its transcription
// state (#341), and the Finalize step (#613) that picks one to keep.
//
// Finalize is how a recording reaches the journal (owner decisions on #613,
// 2026-10-08): always explicit, even for a single recording. The chosen
// one's log block goes into the journal (never silently over writing: if
// the journal holds writing, it asks Add below / Replace / Keep), and every
// other recording for the day is deleted, video and transcript. Recording
// again later leaves the day as it was until it's finalized again, and the
// Journal page warns before leaving with recordings still unfinalized.
//
// The day summary page's links and states are #342.

/** What the finalized recording did to the journal. pending/superseded
 * come from #341's first design and aren't set any more (see the schema's
 * video_log_journal_outcome comment). */
const OUTCOME_NOTE: Record<JournalOutcome, string> = {
  applied: "Finalized. In the journal",
  replaced: "Finalized. Replaced the journal text",
  appended: "Finalized. Added below the journal text",
  kept: "Finalized. Journal kept as written",
  pending: "Waiting for your choice",
  superseded: "Superseded by a newer recording",
};

function statusLine(log: VideoLogSummary, transcriptionNotConfigured: boolean): { text: string; tone: "muted" | "error" } {
  if (log.finalized && log.journalOutcome) return { text: OUTCOME_NOTE[log.journalOutcome], tone: "muted" };
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
      return {
        text: log.transcript?.trim() ? "Transcribed. Not in the journal until you finalize" : "Transcribed. No speech found",
        tone: "muted",
      };
    case "failed":
      return {
        text: `Transcription failed${log.transcriptionError ? `: ${log.transcriptionError}` : ""}. The journal wasn't changed.`,
        tone: "error",
      };
  }
}

function timeOf(log: VideoLogSummary): string {
  return new Date(log.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The take Finalize preselects: the newest one that's transcribed. */
function defaultPrimary(candidates: VideoLogSummary[]): string | null {
  const ready = candidates.filter((l) => l.status === "ready");
  return ready.at(-1)?.id ?? null;
}

export function StoredRecordings({
  date,
  journal,
  recordings,
  playingId,
  onPlay,
  onRetryTranscription,
  transcriptionNotConfigured,
}: {
  date: string;
  /** The day's journal as the server last rendered it; sent with Finalize
   * so a stale page can't overwrite a newer edit. */
  journal: string | null;
  recordings: VideoLogSummary[];
  playingId: string | null;
  onPlay: (log: VideoLogSummary) => void;
  onRetryTranscription: (id: string) => void;
  transcriptionNotConfigured: boolean;
}) {
  const router = useRouter();
  // Takes still uploading from a device can't be chosen or deleted yet.
  const candidates = recordings.filter((l) => l.status !== "uploading");
  const needsFinalize = candidates.some((l) => !l.finalized);
  const [selected, setSelected] = useState<string | null>(null);
  const primaryId =
    selected && candidates.some((l) => l.id === selected) ? selected : defaultPrimary(candidates);
  const primary = candidates.find((l) => l.id === primaryId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choicePreview, setChoicePreview] = useState<string | null>(null);
  // Destructive confirmations use the app's Modal rather than
  // window.confirm(), which iOS Safari can silently answer "no" to (see
  // navigation-blocker.tsx).
  const [confirming, setConfirming] = useState<{ body: string; label: string; choice: JournalChoice | null } | null>(
    null,
  );

  if (recordings.length === 0) return null;

  /** Asks first when the step deletes recordings or replaces writing;
   * otherwise finalizes straight away. */
  function requestFinalize(choice: JournalChoice | null) {
    if (!primary) return;
    const others = candidates.filter((l) => l.id !== primary.id);
    if (choice === null && others.length > 0) {
      const list = others.map((l) => `${timeOf(l)} (${formatElapsed(l.durationMs)})`).join(", ");
      setConfirming({
        body: `This keeps the ${timeOf(primary)} recording and permanently deletes ${others.length} other recording${
          others.length === 1 ? "" : "s"
        } from this day, video and transcript: ${list}.`,
        label: "Finalize and delete",
        choice,
      });
      return;
    }
    if (choice === "replace") {
      setConfirming({
        body: "This replaces the day's journal text with the recording. The current text will be gone.",
        label: "Replace",
        choice,
      });
      return;
    }
    void finalize(choice);
  }

  async function finalize(choice: JournalChoice | null) {
    if (!primary) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/video-logs/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, primaryId: primary.id, choice, shownJournal: journal }),
      });
      const body = (await res.json().catch(() => null)) as (FinalizeResult & { error?: string }) | null;
      if (!res.ok || !body) {
        setError(typeof body?.error === "string" ? body.error : `Couldn't finalize (${res.status})`);
        return;
      }
      if (body.status === "needs-choice") {
        setChoicePreview(body.entry);
        return;
      }
      setChoicePreview(null);
      const problems: string[] = [];
      if (body.skippedUploading > 0) {
        problems.push(`${body.skippedUploading} recording(s) still uploading were left alone; finalize again once they've arrived.`);
      }
      if (body.deleteErrors.length > 0) {
        problems.push(`Couldn't delete ${body.deleteErrors.length} recording(s); finalize again to retry. (${body.deleteErrors.join("; ")})`);
      }
      setNotice(problems.length > 0 ? problems.join(" ") : null);
      router.refresh();
    } catch {
      setError("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Recordings</h3>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {recordings.map((log) => {
          const status = statusLine(log, transcriptionNotConfigured);
          const canRetry = log.status === "failed" || (log.status === "transcribing" && log.transcriptionStale);
          const selectable = needsFinalize && log.status === "ready";
          return (
            <li key={log.id} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className={selectable ? "flex cursor-pointer items-start gap-2.5" : "flex items-start gap-2.5"}>
                  {needsFinalize ? (
                    <input
                      type="radio"
                      name={`primary-${date}`}
                      className="mt-1 size-4 accent-primary"
                      checked={primaryId === log.id}
                      disabled={!selectable || busy}
                      onChange={() => setSelected(log.id)}
                      aria-label={`Keep the ${timeOf(log)} recording`}
                    />
                  ) : null}
                  <span className="flex flex-col">
                    <span className="font-mono text-sm">
                      {log.logNumber !== null ? `#${log.logNumber} · ` : ""}
                      {timeOf(log)} · {formatElapsed(log.durationMs)} · {formatBytes(log.sizeBytes)}
                    </span>
                    <span className={status.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                      {status.text}
                    </span>
                  </span>
                </label>
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

      {needsFinalize && !choicePreview ? (
        <div className="flex flex-col gap-1.5">
          <Button type="button" disabled={!primary || busy} onClick={() => requestFinalize(null)}>
            {busy ? "Finalizing…" : primary ? `Finalize with the ${timeOf(primary)} recording` : "Finalize"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {primary
              ? "Puts this recording in the day's journal and deletes the day's other recordings."
              : "Waiting for a transcript before this day can be finalized."}
          </p>
        </div>
      ) : null}

      {choicePreview ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium">This day&apos;s journal already has writing</p>
            <p className="text-sm text-muted-foreground">What should happen to it when this recording goes in?</p>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer select-none text-muted-foreground">See what would be added</summary>
            <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">{choicePreview}</p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => requestFinalize("append")}>
              Add below my writing
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => requestFinalize("replace")}>
              Replace my writing
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => requestFinalize("keep")}>
              Keep my writing only
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setChoicePreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title="Finalize this day's recording?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{confirming?.body}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const choice = confirming?.choice ?? null;
                setConfirming(null);
                void finalize(choice);
              }}
            >
              {confirming?.label}
            </Button>
          </div>
        </div>
      </Modal>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p> : null}
    </div>
  );
}
