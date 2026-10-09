"use client";

import { useState } from "react";
import Link from "next/link";
import { HudVideoPlayer, playbackHudFor } from "@/components/journal/hud-video-player";
import type { JournalVideo } from "@/lib/video-journal/video-log-types";

/**
 * A /journal entry's finalized video log, watchable in place (#619): the
 * "▶ Video log #N" chip opens an inline player with the mission HUD over it
 * (#599), the same player the Record pane uses. Closed by default, so a
 * page of entries doesn't load 25 videos; nothing is fetched until opened.
 */
export function JournalEntryVideo({ video }: { video: JournalVideo }) {
  const [open, setOpen] = useState(false);
  const label = video.logNumber !== null ? `Video log #${video.logNumber}` : "Video log";
  const recordHref = `/day/${video.date}/journal?mode=record`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {video.playbackUrl ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              open
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-primary/40 text-primary hover:bg-primary/10"
            }`}
          >
            {open ? "■ Close" : "▶ Watch"} {label}
          </button>
        ) : (
          // R2 not configured on this deployment: nothing to play here,
          // but the Record pane still shows the recording's details.
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <Link href={recordHref} className="text-xs text-muted-foreground transition-colors hover:text-primary">
          Open in Record →
        </Link>
      </div>
      {open && video.playbackUrl ? (
        <HudVideoPlayer
          url={video.playbackUrl}
          hud={playbackHudFor(video.hud, video.recordedAt, video.logNumber)}
          stats={video.stats}
          autoPlay
        />
      ) : null}
    </div>
  );
}
