"use client";

import { useState } from "react";
import { MissionHud, type HudLocationState } from "@/components/journal/mission-hud";
import type { HudDiaryStats, HudSnapshot } from "@/lib/video-journal/hud";

/** The fixed viewfinder every journal video plays in: 3:4 on phones, 16:9
 * wider, video centred inside. The mission HUD (#599) needs room for its
 * four corners whatever the video's own shape, so on a mismatch it sits
 * over black bars instead of the corners colliding. */
export const VIEWFINDER =
  "relative mx-auto aspect-[3/4] max-h-[75vh] w-full overflow-hidden rounded-xl bg-black sm:aspect-video";

export type PlaybackHud = {
  logLabel: string;
  startedAt: Date;
  timeZone: string | null;
  location: HudLocationState;
  weather: HudSnapshot["weather"];
};

/** What the playback HUD shows for a recording, from its stored snapshot.
 * Recordings from before the HUD existed have no snapshot and get the time
 * from their recordedAt alone. */
export function playbackHudFor(
  snapshot: HudSnapshot | null | undefined,
  recordedAtIso: string,
  logNumber: number | null,
): PlaybackHud {
  return {
    logLabel: logNumber !== null ? `LOG #${logNumber}` : "LOG —",
    startedAt: new Date(snapshot?.capturedAt ?? recordedAtIso),
    timeZone: snapshot?.timeZone ?? null,
    location: snapshot?.location ? { kind: "ok", location: snapshot.location } : { kind: "unavailable" },
    weather: snapshot?.weather ?? null,
  };
}

/**
 * A recorded video log with the mission HUD redrawn over it (#599). Shared
 * by the Journal day section's Record pane and /journal (#619). The HUD's
 * clock follows the playback position, and the diary stats are whatever
 * the caller read live for that date.
 */
export function HudVideoPlayer({
  url,
  hud,
  stats,
  autoPlay = false,
}: {
  url: string;
  hud: PlaybackHud | null;
  stats: HudDiaryStats | null;
  autoPlay?: boolean;
}) {
  // Tagged with the URL it belongs to, so switching videos starts the HUD
  // clock from 0 without a reset effect.
  const [position, setPosition] = useState<{ url: string; ms: number } | null>(null);
  return (
    <div className={VIEWFINDER}>
      <video
        key={url}
        src={url}
        controls
        playsInline
        autoPlay={autoPlay}
        onTimeUpdate={(e) => setPosition({ url, ms: e.currentTarget.currentTime * 1000 })}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {hud ? (
        <MissionHud
          mode="playback"
          logLabel={hud.logLabel}
          startedAt={hud.startedAt}
          timeZone={hud.timeZone}
          elapsedMs={position?.url === url ? position.ms : 0}
          recording={false}
          location={hud.location}
          weather={hud.weather}
          stats={stats}
        />
      ) : null}
    </div>
  );
}
