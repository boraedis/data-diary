"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useD3 } from "@/hooks/use-d3";
import { Button } from "@/components/ui/button";
import { categoricalColor } from "@/lib/viz/color";
import { formatThousandsNumber } from "@/lib/viz/format";
import {
  interpolateDate,
  interpolateStandings,
  leaderValue,
  raceLabels,
  type RaceFrame,
  type RaceStanding,
} from "@/lib/viz/race";
import { roundedBarPath } from "./marks";
import { styleAxis } from "./axis";

// InteractiveBarRace (#103) — time-stepped animated reordering of a
// ranking, with real transport controls. Legacy's `BarRace`
// (functions/views/vis/vis_functions.js:5147, itself a port of
// https://observablehq.com/@d3/bar-chart-race) redone properly.
//
// **Why this isn't a mode of InteractiveRanked.** #103 is titled as one,
// and the two do sit next to each other conceptually, but they share no
// implementation: InteractiveRanked is deliberately plain HTML/CSS rows
// (see its own header comment for why), while a race needs a rescaling
// x-axis, bars that cross each other mid-flight, and per-frame geometry —
// all of which is SVG work, and all of which the rest of this folder
// already does in D3. Forcing them into one component would mean two
// disjoint render trees behind one prop, so this ships as a sibling
// primitive instead. The shared vocabulary between them is the
// `RankedEntry` shape, which a `RaceFrame` is a list of.
//
// **What's different from legacy, on purpose:**
//  - Legacy built a fixed keyframe list (3 interpolated snapshots per
//    period) and `await`ed a 180ms d3 transition per keyframe inside a
//    `for` loop. That loop *is* the playback clock, which is exactly why
//    it could not be paused, scrubbed or restarted — the only control was
//    reloading the page. Here the clock is a `requestAnimationFrame` loop
//    driving a single position number, and every control (play/pause,
//    scrub, restart, speed) is just a different way of setting it. #103's
//    own framing: this is interaction design work, not a mechanical port.
//  - Interpolation is continuous rather than quantized to thirds, so
//    playback speed is independent of the data's period, and a slow speed
//    doesn't reveal the steps.
//  - Bars are the app's rounded-data-end bar (MARK_SPECS/roundedBarPath),
//    with the palette's fixed-slot colors rather than legacy's per-chart
//    hardcoded hex maps.
//
// **Why direct DOM writes rather than d3 transitions or React state.**
// Every frame moves every bar, so per-frame React state would re-render
// the whole subtree 60 times a second, and `useD3`'s contract (see
// use-d3.ts) is that its render function re-runs from scratch whenever its
// deps change — putting playback position in there would rebuild the SVG
// every frame. So `useD3` builds the scaffolding once per data/size
// change, hands back an `applyFrame` updater through a ref, and the rAF
// loop calls that with plain `.attr()` writes. Nothing about playback
// passes through React except the play/pause button's own label. This is
// the pattern AGENTS.md calls for; it's also why there are no d3
// `.transition()` calls here — the rAF loop already interpolates, and a
// transition on top of it would fight the clock.

const DEFAULT_MARGIN = { top: 24, right: 16, bottom: 12, left: 8 };
/** Room for the ticker (the big period readout) at the bottom right. */
const TICKER_AREA_HEIGHT = 44;
/** Room for the transport row, taken out of the caller's `height` rather
 * than added to it — the same fixed-budget approach InteractiveGeo takes
 * for its legend and InteractiveDonut for its breadcrumb, and for the same
 * reason: the caller's `h-[min(62vh,640px)]` class is a hard cap on the
 * whole component, so anything drawn outside that budget falls out of the
 * card. */
const CONTROLS_AREA_HEIGHT = 44;
/** Bar thickness cap. Unlike a normal bar chart this is generous — a race
 * with 10 rows on a tall viewport should fill it, and MARK_SPECS' 24px cap
 * is sized for a dense multi-series chart, not for rows carrying a name
 * and a number inside them. */
const MAX_BAR_THICKNESS = 44;
const BAND_PADDING = 0.22;
/** Gap between a bar's end and the text riding next to it. */
const LABEL_GAP = 8;
/** Width held back from the plot for the leader's value label. The x scale
 * rescales to the leader every frame, so without this the longest bar ends
 * exactly at the plot edge and its own number is drawn off the SVG. */
const VALUE_LABEL_RESERVE = 60;

/** How fast playback advances, in source frames per second. Named speeds
 * rather than a free slider: three legible choices beat a continuous
 * control nobody can hit precisely, and the middle one is the default. */
const SPEEDS = [
  { id: "slow", label: "0.5×", framesPerSecond: 1.5 },
  { id: "normal", label: "1×", framesPerSecond: 3 },
  { id: "fast", label: "2×", framesPerSecond: 6 },
] as const;
type SpeedId = (typeof SPEEDS)[number]["id"];

export type { RaceFrame } from "@/lib/viz/race";

export type InteractiveBarRaceProps = {
  /** One entry per period, oldest first. The caller does its own
   * bucketing (see viz/bin.ts's boundary note) — this primitive only
   * animates between the frames it's given. */
  frames: RaceFrame[];
  /** Bars drawn at once. Everyone else is still ranked and still
   * interpolated — they simply sit below the cut until they climb into
   * it, which is what makes a newcomer rise into view from the bottom
   * rather than pop into existence. */
  topN?: number;
  width: number;
  height: number;
  /** Bar fill — a single color, or a function keyed off the label, the
   * same shape InteractiveRanked and InteractiveNetwork take. Defaults to
   * the palette's fixed slots by first-appearance order (see
   * `raceLabels`), which for more than five racers means most bars are the
   * palette's muted neutral — pass a real color function (a per-group
   * color, say) for anything with a wide field. */
  color?: string | ((label: string, index: number) => string);
  /** Formats the number riding each bar. */
  formatValue?: (value: number) => string;
  /** Formats the ticker. Defaults to "Mar 2024". */
  formatDate?: (date: Date) => string;
  /** Whether playback starts on its own. Ignored when the viewer has
   * `prefers-reduced-motion` set — see the effect below. */
  autoPlay?: boolean;
  ariaLabel?: string;
};

const DEFAULT_DATE_FORMAT = d3.timeFormat("%b %Y");

/** Bound to every bar/label group, mutated in place each frame. Standing
 * data must never be reallocated per frame — this is 60Hz work over every
 * visible row. */
type BarDatum = { label: string; standing: RaceStanding };

export function InteractiveBarRace({
  frames,
  topN = 10,
  width,
  height,
  color,
  formatValue = formatThousandsNumber,
  formatDate = DEFAULT_DATE_FORMAT,
  autoPlay = true,
  ariaLabel = "Animated ranking over time",
}: InteractiveBarRaceProps) {
  const scrubId = useId();
  // useId's own value contains colons, which are legal in an id but awful
  // inside a `url(#...)` reference — stripped rather than risking it.
  const clipId = `race-clip-${useId().replace(/:/g, "")}`;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SpeedId>("normal");

  /** Playback position in fractional frame units. A ref, not state: it
   * changes every animation frame and nothing in React's tree may depend
   * on it. */
  const positionRef = useRef(0);
  const applyFrameRef = useRef<((position: number) => void) | null>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);

  const lastIndex = Math.max(0, frames.length - 1);

  // Formatters and the color callback are read through a ref rather than
  // captured in `useD3`'s deps: a caller passing an inline arrow (the
  // normal thing to do) would otherwise rebuild the whole SVG on every
  // React render, including every play/pause toggle. The effect below
  // repaints the current frame when any of them actually change identity,
  // which is cheap — one frame over at most `topN + 1` rows.
  const latest = useRef({ colorFor: (() => "") as (label: string, index: number) => string, formatValue, formatDate });

  const colorFor = useMemo(() => {
    if (typeof color === "function") return color;
    if (typeof color === "string") return () => color;
    // Default: fixed-slot palette by first-appearance order. Computed once
    // per frame set, not per animation frame.
    const order = new Map(raceLabels(frames).map((label, i) => [label, i]));
    return (label: string) => categoricalColor(Math.min(order.get(label) ?? 0, 5));
  }, [color, frames]);

  // Publishes the callbacks the render function reads, and repaints when
  // one of them actually changes. Declared above `useD3` on purpose:
  // effects run in declaration order, so on mount this fills the ref
  // before the render function below reads it.
  useEffect(() => {
    latest.current = { colorFor, formatValue, formatDate };
    applyFrameRef.current?.(positionRef.current);
  }, [colorFor, formatValue, formatDate]);

  const svgHeight = Math.max(0, height - CONTROLS_AREA_HEIGHT);
  const innerWidth = Math.max(0, width - DEFAULT_MARGIN.left - DEFAULT_MARGIN.right);
  const innerHeight = Math.max(
    0,
    svgHeight - DEFAULT_MARGIN.top - DEFAULT_MARGIN.bottom - TICKER_AREA_HEIGHT,
  );

  const svgRef = useD3<SVGSVGElement>(
    (svg) => {
      if (frames.length === 0 || innerWidth <= 0 || innerHeight <= 0) return;

      svg
        .attr("viewBox", `0 0 ${width} ${svgHeight}`)
        .attr("width", width)
        .attr("height", svgHeight);

      const plot = svg
        .append("g")
        .attr("transform", `translate(${DEFAULT_MARGIN.left},${DEFAULT_MARGIN.top})`);

      const x = d3
        .scaleLinear()
        .range([0, Math.max(10, innerWidth - VALUE_LABEL_RESERVE)]);
      // One extra band beyond `topN`, sitting *past* the bottom of the
      // plot: the row below the cut is where a bar climbing into view
      // comes from and where a falling one goes, so it has to exist as a
      // position — but drawing it inside the plot would cost a visible row
      // to something the reader isn't meant to be reading. The SVG
      // viewport clips it, so it reads as rising in from off-chart.
      const y = d3
        .scaleBand<number>()
        .domain(d3.range(topN + 1))
        .range([0, (innerHeight * (topN + 1)) / topN])
        .padding(BAND_PADDING);
      const barThickness = Math.min(MAX_BAR_THICKNESS, y.bandwidth());
      // Floors at the app's own axis-tick size — a name that has to be
      // read while it moves can't go below what a static tick uses.
      const labelFontSize = Math.max(11, Math.min(14, barThickness * 0.45));

      // Axis on top, gridlines dropping through the plot — a horizontal
      // bar chart's scale belongs where the eye starts, and the bars are
      // constantly changing length underneath it. `styleAxis` gives it the
      // app's standard chrome; the long inner ticks are drawn separately
      // (as gridlines) rather than by `tickSizeInner`, so they can be
      // faint without the axis text following them.
      const axisG = plot.append("g").attr("aria-hidden", "true");
      const gridG = plot.append("g").attr("aria-hidden", "true");

      // Bars and labels share one <g> per row so a single transform moves
      // them together — legacy kept them in separate groups and applied the
      // same y translation twice. The group is clipped to the plot so the
      // extra below-the-cut band (see the y scale above) stays off-screen
      // and a climbing bar slides in from the bottom edge rather than
      // appearing in the ticker's whitespace.
      svg
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", innerWidth)
        .attr("height", innerHeight);
      const rowsG = plot.append("g").attr("clip-path", `url(#${clipId})`);

      const ticker = svg
        .append("text")
        .attr("aria-hidden", "true")
        .attr("text-anchor", "end")
        .attr("x", width - DEFAULT_MARGIN.right)
        .attr("y", svgHeight - DEFAULT_MARGIN.bottom)
        .attr("fill", "var(--muted-foreground)")
        .attr("opacity", 0.5)
        .style("font-size", `${Math.min(40, Math.max(20, innerWidth / 14))}px`)
        .style("font-weight", "600")
        .style("font-variant-numeric", "tabular-nums");

      const applyFrame = (position: number) => {
        const { colorFor: colorOf, formatValue: valueFormat, formatDate: dateFormat } = latest.current;
        const standings = interpolateStandings(frames, position);
        const max = leaderValue(standings);
        x.domain([0, max]);

        const ticks = Math.max(2, Math.floor(innerWidth / 110));
        styleAxis(axisG, d3.axisTop(x).ticks(ticks).tickSizeOuter(0).tickFormat((d) => valueFormat(d as number)));
        gridG
          .call(
            d3
              .axisTop(x)
              .ticks(ticks)
              .tickSize(-innerHeight)
              .tickFormat(() => ""),
          )
          .call((sel) => sel.select(".domain").remove())
          .call((sel) =>
            sel.selectAll("line").attr("stroke", "var(--border)").attr("stroke-opacity", 0.4),
          );

        // Only rows near the cut exist in the DOM. Everyone else is a
        // number in `standings` and nothing more, so a race over hundreds
        // of labels costs the same per frame as one over a dozen.
        const visible = standings
          .slice(0, topN + 1)
          .map<BarDatum>((standing) => ({ label: standing.label, standing }));

        rowsG
          .selectAll<SVGGElement, BarDatum>("g.race-row")
          // Keyed by label so a row keeps its identity (and its DOM node)
          // as it changes rank — the join is what makes bars cross rather
          // than teleport.
          .data(visible, (d) => d.label)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "race-row");
              g.append("path").attr("class", "race-bar");
              g.append("text")
                .attr("class", "race-name")
                .attr("dominant-baseline", "middle")
                .style("font-size", `${labelFontSize}px`)
                .text((d) => d.label);
              g.append("text")
                .attr("class", "race-value")
                .attr("dominant-baseline", "middle")
                .attr("fill", "var(--muted-foreground)")
                .style("font-size", `${labelFontSize}px`)
                .style("font-variant-numeric", "tabular-nums");
              return g;
            },
            (update) => update,
            (exit) => exit.remove(),
          )
          .each(function (d) {
            const row = d3.select(this);
            const bandY = y(Math.min(d.standing.rank, topN)) ?? 0;
            const barWidth = Math.max(0, x(Math.max(0, d.standing.value)));
            // A row past the cut fades rather than clipping abruptly at
            // the plot edge, so the bottom of the chart reads as "there's
            // more below" instead of as a hard truncation.
            row
              .attr("transform", `translate(0,${bandY + (y.bandwidth() - barThickness) / 2})`)
              .attr("opacity", d.standing.rank >= topN ? 0.35 : 1);
            row
              .select<SVGPathElement>("path.race-bar")
              .attr("d", roundedBarPath(0, 0, barWidth, barThickness, "right"))
              .attr("fill", colorOf(d.label, d.standing.rank));

            // The name rides inside its own bar while it fits and flips
            // outside once the bar is too short to hold it — legacy's own
            // behaviour (it compared bar length against a measured text
            // width), here approximated from the character count rather
            // than measured, since measuring every label every frame would
            // cost a layout pass per row per frame. The approximation only
            // decides which side of the bar's end the text sits on; a
            // wrong guess is a slightly early or late flip, never
            // unreadable text.
            const approxNameWidth = d.label.length * labelFontSize * 0.58;
            const inside = barWidth > approxNameWidth + LABEL_GAP * 2;
            row
              .select<SVGTextElement>("text.race-name")
              .attr("x", inside ? barWidth - LABEL_GAP : barWidth + LABEL_GAP)
              .attr("y", barThickness / 2)
              .attr("text-anchor", inside ? "end" : "start")
              .attr("fill", inside ? "var(--card)" : "var(--foreground)");
            row
              .select<SVGTextElement>("text.race-value")
              .attr("x", inside ? barWidth + LABEL_GAP : barWidth + LABEL_GAP + approxNameWidth + LABEL_GAP)
              .attr("y", barThickness / 2)
              .text(valueFormat(d.standing.value));
          });

        const date = interpolateDate(frames, position);
        ticker.text(date ? dateFormat(date) : "");
      };

      applyFrameRef.current = applyFrame;
      applyFrame(positionRef.current);

      return () => {
        applyFrameRef.current = null;
      };
    },
    [frames, topN, width, svgHeight, innerWidth, innerHeight, clipId],
  );

  /** Moves the clock and repaints, without going through React. The scrub
   * input is written to directly for the same reason the bars are. */
  const seek = useCallback(
    (position: number) => {
      const clamped = Math.min(Math.max(position, 0), lastIndex);
      positionRef.current = clamped;
      applyFrameRef.current?.(clamped);
      // Skipped mid-drag only: writing to the input while a pointer is
      // holding the thumb fights the drag. Keyboard focus is fine to write
      // through, since an arrow key pauses playback anyway.
      if (scrubRef.current && !draggingRef.current) {
        scrubRef.current.value = String(clamped);
      }
      return clamped;
    },
    [lastIndex],
  );

  // The clock. Runs only while playing, and stops itself at the end rather
  // than looping — a race that silently restarts leaves the viewer unsure
  // whether they're watching the beginning or the middle.
  useEffect(() => {
    if (!playing) return;
    const framesPerSecond = SPEEDS.find((s) => s.id === speed)?.framesPerSecond ?? 3;
    let raf = 0;
    let previous: number | null = null;

    const tick = (now: number) => {
      const deltaSeconds = previous === null ? 0 : (now - previous) / 1000;
      previous = now;
      const next = seek(positionRef.current + deltaSeconds * framesPerSecond);
      if (next >= lastIndex) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, seek, lastIndex]);

  // Autoplay, unless the viewer asked for less motion — in which case the
  // chart still works, it just waits to be played or scrubbed. Deliberately
  // not a one-shot mount effect: the query is read at mount only, which is
  // enough for a preference that virtually never changes mid-session, and
  // re-running on a data change would restart a race the viewer is
  // watching.
  useEffect(() => {
    if (!autoPlay) return;
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // The media query can only be read on the client, so this can't move
    // into the initial state without the server rendering "Pause" and the
    // client correcting it — a hydration mismatch on every load. One
    // extra render at mount is the cheaper of the two.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!reduced) setPlaying(true);
    // `autoPlay` is deliberately not a dependency: this is a "start once
    // at mount" decision, and re-running it would restart a race the
    // viewer had paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlayPause = () => {
    // Pressing play at the finish line restarts rather than doing nothing,
    // which is what every media control does and what the alternative
    // (a dead button) fails to do.
    if (!playing && positionRef.current >= lastIndex) seek(0);
    setPlaying((p) => !p);
  };

  const handleRestart = () => {
    seek(0);
    setPlaying(true);
  };

  const empty = frames.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* The race is a moving picture with no accessible reading of its
          own — `role="img"` plus a caller-supplied description is the
          honest treatment. The transport controls below are real,
          labelled, focusable controls, and the chart is fully usable
          paused and scrubbed from the keyboard. */}
      <svg ref={svgRef} role="img" aria-label={ariaLabel} className="w-full" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={handlePlayPause}
          disabled={empty}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={handleRestart}
          disabled={empty}
          aria-label="Restart"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Restart
        </Button>
        <label htmlFor={scrubId} className="sr-only">
          Scrub through time
        </label>
        <input
          ref={scrubRef}
          id={scrubId}
          type="range"
          min={0}
          max={lastIndex}
          // Fine enough that dragging feels continuous rather than
          // snapping period to period, and it's the same fractional
          // position the clock uses.
          step={0.01}
          defaultValue={0}
          disabled={empty}
          onPointerDown={() => {
            draggingRef.current = true;
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          onChange={(event) => {
            setPlaying(false);
            seek(Number(event.target.value));
          }}
          className="h-1.5 min-w-40 flex-1 cursor-pointer accent-[var(--chart-1)]"
        />
        <div role="group" aria-label="Speed" className="flex items-center gap-1">
          {SPEEDS.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="xs"
              variant={speed === option.id ? "secondary" : "ghost"}
              aria-pressed={speed === option.id}
              onClick={() => setSpeed(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
