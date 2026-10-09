"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { JournalChoice } from "@/lib/video-journal/journal-rules";
import type { VideoLogSummary } from "@/lib/video-journal/video-log-types";

/**
 * The overwrite confirmation from #341, as revised on #338 (2026-10-08): a
 * transcript never silently replaces writing. When a recording's
 * transcript is ready but the day's journal already holds writing (or an
 * edited transcript), this asks what to do with it. Shown above both the
 * Write and Record panes, since it's about the journal text itself.
 *
 * Keep my writing loses nothing: the transcript stays on its recording,
 * listed under Record, and stays searchable.
 */
export function TranscriptChoice({ log, shownJournal }: { log: VideoLogSummary; shownJournal: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: JournalChoice) {
    if (
      choice === "replace" &&
      !window.confirm("Replace this day's journal with the transcript? The current text will be gone; this can't be undone.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/video-logs/${log.id}/journal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, shownJournal }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : `Couldn't save that (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const time = new Date(log.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div>
        <p className="text-sm font-medium">Transcript ready for your {time} recording</p>
        <p className="text-sm text-muted-foreground">
          This day&apos;s journal already has writing, so it wasn&apos;t changed. What should happen to the transcript?
        </p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">See what would be added</summary>
        {/* The full log block (header + transcript), exactly as Replace or
            Append would write it. */}
        <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
          {log.journalEntry ?? log.transcript}
        </p>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void choose("append")}>
          Add below my writing
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void choose("replace")}>
          Replace my writing
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void choose("keep")}>
          Keep my writing only
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
