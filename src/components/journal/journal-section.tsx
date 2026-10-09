"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { JournalWriteForm } from "@/components/journal/journal-write-form";
import { useTranscriptionSync } from "@/components/journal/use-transcription-sync";
import { VideoRecorder } from "@/components/journal/video-recorder";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { HudDiaryStats } from "@/lib/video-journal/hud";
import type { VideoLogSummary } from "@/lib/video-journal/video-log-types";

export type JournalMode = "write" | "record";

const MODES: { value: JournalMode; label: string }[] = [
  { value: "write", label: "Write" },
  { value: "record", label: "Record" },
];

/**
 * The Journal day section's two equal ways in: Write and Record (#340,
 * epic #338). Neither is the "real" one. A day can be text-only,
 * video-only or both, so the switch is a plain two-way toggle. Which pane
 * opens first follows the day's content (the page passes Record when the
 * day has recordings), not a preference for one way of journaling.
 *
 * Both panes stay mounted and the inactive one is only hidden. Switching
 * to check something in the other pane must not throw away a half-written
 * paragraph or stop a recording in progress.
 *
 * The mode is mirrored into `?mode=` with `history.replaceState` (no
 * navigation, so no server round trip) so a reload lands back in the
 * same pane, and a bookmark/home-screen link can open straight to Record.
 * Both modes are written explicitly, `write` included: without `?mode=`
 * the page picks a default (Record when the day has recordings), and a
 * reload shouldn't override a choice the user just made.
 */
export function JournalSection({
  date,
  initialMode,
  initialJournal,
  videoLogs,
  videoLogsError,
  nextLogNumber,
  diaryStats,
}: {
  date: string;
  initialMode: JournalMode;
  initialJournal: string | null;
  videoLogs: VideoLogSummary[];
  videoLogsError: string | null;
  nextLogNumber: number;
  diaryStats: HudDiaryStats;
}) {
  const [mode, setMode] = useState<JournalMode>(initialMode);
  const transcription = useTranscriptionSync(videoLogs);

  // One leave-without-saving guard for the whole page. The guard is a
  // single shared flag (navigation-blocker.tsx), so two components each
  // setting it would overwrite each other; the panes report up instead.
  // Recordings that aren't finalized count too (owner decision on #613):
  // leaving keeps everything, but the day's journal won't have the new
  // take until it's finalized.
  const [writeDirty, setWriteDirty] = useState(false);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const unfinalized = videoLogs.some((l) => !l.finalized && l.status !== "uploading");
  useUnsavedChangesGuard(writeDirty || recorderBusy || unfinalized);
  const onWriteDirty = useCallback((dirty: boolean) => setWriteDirty(dirty), []);
  const onRecorderBusy = useCallback((busy: boolean) => setRecorderBusy(busy), []);

  function choose(next: JournalMode) {
    setMode(next);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div className="flex flex-col gap-4">
      {transcription.error ? <p className="text-sm text-destructive">{transcription.error}</p> : null}
      <div role="tablist" aria-label="Journal mode" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            id={`journal-tab-${m.value}`}
            aria-selected={mode === m.value}
            aria-controls={`journal-panel-${m.value}`}
            onClick={() => choose(m.value)}
            className={cn(
              "rounded-lg py-2 text-sm font-medium transition-colors",
              mode === m.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="journal-panel-write"
        aria-labelledby="journal-tab-write"
        hidden={mode !== "write"}
      >
        <JournalWriteForm date={date} initial={initialJournal} onDirtyChange={onWriteDirty} />
      </div>
      <div
        role="tabpanel"
        id="journal-panel-record"
        aria-labelledby="journal-tab-record"
        hidden={mode !== "record"}
      >
        <VideoRecorder
          date={date}
          videoLogs={videoLogs}
          videoLogsError={videoLogsError}
          onRetryTranscription={(id) => void transcription.retry(id)}
          transcriptionNotConfigured={transcription.notConfigured}
          journal={initialJournal}
          onBusyChange={onRecorderBusy}
          nextLogNumber={nextLogNumber}
          diaryStats={diaryStats}
        />
      </div>
    </div>
  );
}
