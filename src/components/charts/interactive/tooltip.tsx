"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { SeriesKey } from "./legend";

// Shared tooltip + crosshair (#17's "shared tooltip component" and
// "crosshair hook" scope items) — the interactive half of the toolkit.
// Replaces both today's nothing (HappinessAveragerChart's native
// `<title>` per-point, which shows one series at a time and never on
// keyboard focus) and legacy `InteractiveScroller`'s fully hand-built
// in-SVG tooltip (functions/views/vis/vis_functions.js).

export type TooltipRow = {
  /** Series name — plain JSX text (React escapes text children the same
   * way `textContent` does), never interpolated into markup, since series
   * names are user-entered data (tags, place names, person names). */
  label: string;
  /** Already-formatted value string (e.g. via `@/lib/viz/format`) — this
   * component doesn't format numbers itself. */
  value: string;
  color: string;
};

/**
 * Floating value readout, positioned near `(x, y)` (pixels, relative to a
 * `position: relative` ancestor — see `ResponsiveChart`, which provides
 * one). Flips to the opposite side once it would overflow `containerWidth`
 * on the right, so it's never clipped at the chart's edge. Value leads
 * (high contrast), series name follows — the `<Legend>` hierarchy
 * inverted, since here the reader already has the series and wants the
 * number. Purely presentational: callers decide *when* to render it (from
 * `useCrosshair` state, or a per-mark hover callback).
 */
export function ChartTooltip({
  x,
  y,
  title,
  rows,
  containerWidth,
}: {
  x: number;
  y: number;
  /** Optional heading above the rows — typically the formatted date or
   * category the crosshair/mark resolved to. */
  title?: string;
  rows: TooltipRow[];
  containerWidth: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Re-measure on every position change rather than assuming a fixed
    // width — row content (series names, values) varies per point.
    setFlip(x + 12 + el.offsetWidth > containerWidth);
  }, [x, containerWidth, rows]);

  if (rows.length === 0) return null;

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-0 left-0 z-10 min-w-max rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md"
      style={{
        transform: flip
          ? `translate(calc(${x}px - 100% - 12px), calc(${y}px - 50%))`
          : `translate(calc(${x}px + 12px), calc(${y}px - 50%))`,
      }}
    >
      {title ? <div className="mb-1 font-medium text-popover-foreground">{title}</div> : null}
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-1.5">
            <SeriesKey color={row.color} variant="line" />
            <span className="font-semibold text-popover-foreground tabular-nums">{row.value}</span>
            <span className="text-muted-foreground">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type CrosshairState<T> = {
  index: number | null;
  point: T | null;
  /** Snapped pixel X, relative to the interaction surface's own left
   * edge — feed straight into `<ChartTooltip x={pixelX} .../>` (offset by
   * the chart's own MARGIN.left if the tooltip lives outside the plot
   * area's own positioned ancestor). */
  pixelX: number | null;
};

export type CrosshairHandlers = {
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  tabIndex: number;
};

/**
 * The "crosshair finds the X" half of interaction.md: given each datum's
 * already-scaled pixel X (ascending order — a time/linear x-scale applied
 * to already-sorted data), tracks the pointer and snaps to the nearest
 * data position via `d3.bisectCenter`, with the same result reachable by
 * keyboard (ArrowLeft/ArrowRight step, Escape/blur clears) — "same details
 * on keyboard focus as on hover" is a hard requirement, not a nice-to-have.
 *
 * Deliberately X-only and DOM-agnostic: spread `handlers` onto whatever
 * plain HTML element covers the plot's inner area (a transparent
 * `position:absolute` div sized to `innerWidth`×`innerHeight` is the usual
 * choice) — kept outside the `useD3`-rendered `<svg>` on purpose, since
 * that redraws its entire contents from scratch on every dependency
 * change (see `use-d3.ts`), which pointer-move-driven state must not
 * trigger.
 */
export function useCrosshair<T>(data: T[], xPositions: number[]): CrosshairState<T> & { handlers: CrosshairHandlers } {
  const [index, setIndex] = useState<number | null>(null);

  const moveTo = useCallback(
    (localX: number) => {
      if (xPositions.length === 0) return;
      setIndex(d3.bisectCenter(xPositions, localX));
    },
    [xPositions],
  );

  const handlers: CrosshairHandlers = {
    onPointerMove: (event) => moveTo(event.nativeEvent.offsetX),
    onPointerLeave: () => setIndex(null),
    onFocus: () => setIndex((current) => current ?? (xPositions.length ? xPositions.length - 1 : null)),
    onBlur: () => setIndex(null),
    onKeyDown: (event) => {
      if (xPositions.length === 0) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => Math.max(0, (current ?? xPositions.length) - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => Math.min(xPositions.length - 1, (current ?? -1) + 1));
      } else if (event.key === "Escape") {
        setIndex(null);
      }
    },
    tabIndex: 0,
  };

  return {
    index,
    point: index !== null ? (data[index] ?? null) : null,
    pixelX: index !== null ? (xPositions[index] ?? null) : null,
    handlers,
  };
}
