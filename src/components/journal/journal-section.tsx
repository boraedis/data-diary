"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { JournalWriteForm } from "@/components/journal/journal-write-form";
import { VideoRecorder } from "@/components/journal/video-recorder";
import type { VideoLogSummary } from "@/lib/video-journal/video-log-types";

export type JournalMode = "write" | "record";

const MODES: { value: JournalMode; label: string }[] = [
  { value: "write", label: "Write" },
  { value: "record", label: "Record" },
];

/**
 * The Journal day section's two equal ways in: Write and Record (#340,
 * epic #338). Neither is the "real" one. A day can be text-only,
 * video-only or both, so the switch is a plain two-way toggle with no
 * default nudging towards either.
 *
 * Both panes stay mounted and the inactive one is only hidden. Switching
 * to check something in the other pane must not throw away a half-written
 * paragraph or stop a recording in progress.
 *
 * The mode is mirrored into `?mode=` with `history.replaceState` (no
 * navigation, so no server round trip) so a reload lands back in the
 * same pane, and a bookmark/home-screen link can open straight to Record.
 */
export function JournalSection({
  date,
  initialMode,
  initialJournal,
  videoLogs,
}: {
  date: string;
  initialMode: JournalMode;
  initialJournal: string | null;
  videoLogs: VideoLogSummary[];
}) {
  const [mode, setMode] = useState<JournalMode>(initialMode);

  function choose(next: JournalMode) {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === "write") url.searchParams.delete("mode");
    else url.searchParams.set("mode", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div className="flex flex-col gap-4">
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
        <JournalWriteForm date={date} initial={initialJournal} />
      </div>
      <div
        role="tabpanel"
        id="journal-panel-record"
        aria-labelledby="journal-tab-record"
        hidden={mode !== "record"}
      >
        <VideoRecorder date={date} videoLogs={videoLogs} />
      </div>
    </div>
  );
}
