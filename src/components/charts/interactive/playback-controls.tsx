"use client";

import { useId } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// The time-lapse control row, shared by the people network (#437) and the
// people treemap (#213). Extracted from people-network-chart.tsx when the
// treemap became its second user, so the two time-lapses can't drift into
// two slightly different controls.

/** Time-lapse speeds, in frames per second — the same three named choices
 * InteractiveBarRace offers, rather than a free slider. The network's
 * frames are the expensive case: a frame re-runs its significance test
 * and rebuilds the SVG, and a near-full frame of the whole history
 * measured 50–90ms in the (unminified) dev build, inside even 2×'s 125ms.
 * Default 1× plays a decade of monthly frames in about half a minute. */
export const PLAYBACK_SPEEDS = [
  { id: "slow", label: "0.5×", framesPerSecond: 2 },
  { id: "normal", label: "1×", framesPerSecond: 4 },
  { id: "fast", label: "2×", framesPerSecond: 8 },
] as const;
export type PlaybackSpeedId = (typeof PLAYBACK_SPEEDS)[number]["id"];

/** Play/Pause, Restart, a scrubber and speed — laid out and labelled like
 * InteractiveBarRace's control row, so every time-lapse in the app reads
 * as one control. Frames are whole steps (months, for both current
 * callers — see monthlyFrameEnds), so the scrubber steps by one rather
 * than the bar race's fractional positions. */
export function PlaybackControls({
  playing,
  frame,
  lastFrame,
  speed,
  onPlayPause,
  onRestart,
  onScrub,
  onSpeed,
  startLabel,
  endLabel,
}: {
  playing: boolean;
  frame: number;
  lastFrame: number;
  speed: PlaybackSpeedId;
  onPlayPause: () => void;
  onRestart: () => void;
  onScrub: (frame: number) => void;
  onSpeed: (speed: PlaybackSpeedId) => void;
  /** The scrubber's two ends, now that it's the page's only time control. */
  startLabel: string;
  endLabel: string;
}) {
  const scrubId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="xs" variant="secondary" onClick={onPlayPause} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
        {playing ? "Pause" : "Play"}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={onRestart} aria-label="Restart">
        <RotateCcw aria-hidden className="size-3.5" />
        Restart
      </Button>
      <label htmlFor={scrubId} className="sr-only">
        Scrub through time
      </label>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{startLabel}</span>
      <input
        id={scrubId}
        type="range"
        min={0}
        max={lastFrame}
        step={1}
        value={frame}
        onChange={(event) => onScrub(Number(event.target.value))}
        className="h-1.5 min-w-40 flex-1 cursor-pointer accent-[var(--chart-1)]"
      />
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{endLabel}</span>
      <div role="group" aria-label="Speed" className="flex items-center gap-1">
        {PLAYBACK_SPEEDS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="xs"
            variant={speed === option.id ? "secondary" : "ghost"}
            aria-pressed={speed === option.id}
            onClick={() => onSpeed(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
