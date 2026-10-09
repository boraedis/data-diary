"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  diaryStatLines,
  formatCoords,
  formatHudClock,
  formatPlace,
  formatWeather,
  type HudDiaryStats,
  type HudLocation,
  type HudWeather,
} from "@/lib/video-journal/hud";
import { formatElapsed } from "@/lib/video-journal/recording";

// The mission HUD overlay (#599, epic #338): the Martian-vlog readout drawn
// over the camera while recording and over the video on playback. Always an
// overlay, never part of the file (see src/lib/video-journal/hud.ts for the
// decisions). "Mission terminal" look, the owner's pick: monospace caps in
// the four corners with thin corner brackets, white on a soft scrim so it
// stays readable over any background.
//
// pointer-events-none throughout, so it never gets in the way of the
// video's own controls on playback.

export type HudLocationState =
  | { kind: "pending" }
  | { kind: "ok"; location: HudLocation }
  /** Permission denied, no fix, or not captured for this recording. */
  | { kind: "unavailable" };

type Props = {
  mode: "live" | "playback";
  /** "LOG #13" (provisional while recording) or "LOG —". */
  logLabel: string;
  /** Live: ignored, the clock shows now. Playback: when recording started;
   * the clock shows that plus the playback position. */
  startedAt: Date | null;
  timeZone: string | null;
  /** Live: time recorded so far (0 when not recording). Playback: the
   * video's current position. */
  elapsedMs: number;
  recording: boolean;
  location: HudLocationState;
  weather: HudWeather | null;
  stats: HudDiaryStats | null;
  /** Live only: the mic stream, for the level meter. */
  audioStream?: MediaStream | null;
};

export function MissionHud(props: Props) {
  const { mode, logLabel, startedAt, timeZone, elapsedMs, recording, location, weather, stats, audioStream } = props;
  const now = useNow(mode === "live");
  const clockAt =
    mode === "live" ? now : startedAt ? new Date(startedAt.getTime() + elapsedMs) : null;

  const place = location.kind === "ok" ? formatPlace(location.location) : null;
  const statLines = diaryStatLines(stats);

  return (
    <div
      className="pointer-events-none absolute inset-0 font-mono text-[10px] leading-snug tracking-wider text-white uppercase sm:text-xs"
      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
      aria-hidden
    >
      <Corner position="top-left">
        <div className="font-semibold">{logLabel}</div>
        {clockAt ? <div>{formatHudClock(clockAt, timeZone)}</div> : null}
      </Corner>

      <Corner position="top-right">
        {mode === "live" ? (
          <>
            {recording ? (
              <div className="flex items-center justify-end gap-1.5 font-semibold">
                <span className="size-2 animate-pulse rounded-full bg-red-500" />
                REC {formatElapsed(elapsedMs)}
              </div>
            ) : (
              <div className="opacity-80">STANDBY</div>
            )}
            {/* Up here rather than under the stats, so both bottom corners
                stay three lines (#599). */}
            {audioStream ? <AudioMeter stream={audioStream} /> : null}
          </>
        ) : (
          <div className="font-semibold">▶ {formatElapsed(elapsedMs)}</div>
        )}
      </Corner>

      <Corner position="bottom-left" lift={mode === "playback"}>
        {location.kind === "pending" ? <div className="opacity-80">LOCATING…</div> : null}
        {location.kind === "unavailable" ? (
          <div className="opacity-80">{mode === "live" ? "NO GPS SIGNAL" : "NO GPS DATA"}</div>
        ) : null}
        {location.kind === "ok" ? (
          <>
            {place ? <div className="font-semibold">{place}</div> : null}
            <div>{formatCoords(location.location.lat, location.location.lng)}</div>
          </>
        ) : null}
        {weather ? <div>{formatWeather(weather)}</div> : null}
      </Corner>

      <Corner position="bottom-right" lift={mode === "playback"}>
        {statLines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </Corner>
    </div>
  );
}

const CORNER: Record<"top-left" | "top-right" | "bottom-left" | "bottom-right", string> = {
  "top-left": "top-2 left-2 border-t border-l text-left sm:top-3 sm:left-3",
  "top-right": "top-2 right-2 border-t border-r text-right sm:top-3 sm:right-3",
  "bottom-left": "bottom-2 left-2 border-b border-l text-left sm:bottom-3 sm:left-3",
  "bottom-right": "bottom-2 right-2 border-b border-r text-right sm:bottom-3 sm:right-3",
};

/** One corner block: a thin L-shaped bracket on the outer edges, with the
 * text on a soft scrim. Empty corners draw nothing. `lift` raises a bottom
 * corner clear of the video element's own controls bar on playback. */
function Corner({
  position,
  lift = false,
  children,
}: {
  position: keyof typeof CORNER;
  lift?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute flex max-w-[48%] flex-col gap-0.5 rounded-[2px] border-white/60 bg-black/25 px-2 py-1.5 empty:hidden ${
        lift ? CORNER[position].replace("bottom-2", "bottom-16").replace("sm:bottom-3", "sm:bottom-16") : CORNER[position]
      }`}
    >
      {children}
    </div>
  );
}

/** Ticks once a second while `active`, for the live clock. */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

const BARS = 6;

/**
 * Live mic level, which also works as a mic check before a long take. Bars
 * are driven by direct DOM writes from a requestAnimationFrame loop, not
 * React state, so 60 updates a second don't re-render anything (same rule
 * as the charts' pointer handling, AGENTS.md → useD3).
 *
 * Live only. On playback the video comes from a cross-origin R2 URL, and
 * routing a cross-origin <video> through Web Audio without CORS silences
 * its audio, so a playback meter would mute the log.
 *
 * iOS Safari may keep the AudioContext suspended outside a user gesture.
 * The meter then just sits flat; recording isn't affected.
 */
function AudioMeter({ stream }: { stream: MediaStream }) {
  const barsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (stream.getAudioTracks().length === 0) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;

    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      // RMS, boosted so normal speech fills most of the meter.
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      const bars = barsRef.current?.children;
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          (bars[i] as HTMLElement).style.opacity = level > i / BARS ? "1" : "0.25";
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="flex items-end justify-end gap-1.5">
      <div ref={barsRef} className="flex h-3 items-end gap-[2px]">
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} className="w-[3px] bg-white" style={{ height: `${30 + i * 14}%`, opacity: 0.25 }} />
        ))}
      </div>
      MIC
    </div>
  );
}
