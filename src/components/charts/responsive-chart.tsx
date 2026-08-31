"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ResponsiveChartProps = {
  /** Fixed chart height in px — use this for a chart whose height should
   * come from its own content (a calendar's row count, a small-multiples
   * grid's mini-chart size), not from available screen space. Omit it to
   * size height from the container's own CSS instead: give `className` a
   * height utility (e.g. "h-[min(62vh,640px)]") and the container's
   * *rendered* height drives `children`'s height argument the same way
   * width already works — so the chart actually grows to fill available
   * vertical space on a tall desktop viewport instead of sitting at a
   * small fixed number. (User feedback on the chart pages: width alone
   * being responsive wasn't enough — "still not max height.") */
  height?: number;
  minWidth?: number;
  className?: string;
  /** Optional callback ref to the measured wrapper div (the `position:
   * relative` ancestor below) — for a caller that needs to convert a
   * pointer event's viewport-relative clientX/clientY into coordinates
   * local to this component, e.g. a per-mark hover tooltip anchored to
   * the pointer (see histogram-chart.tsx). Most callers don't need this —
   * the crosshair pattern (happiness-averager-chart.tsx) doesn't, since
   * its own interaction overlay's `offsetX` is already local. */
  wrapperRef?: (el: HTMLDivElement | null) => void;
  children: (dimensions: { width: number; height: number }) => React.ReactNode;
};

/** Measures its container's width — and, when `height` is omitted, its
 * height too — via ResizeObserver, and passes {width, height} to
 * `children` as a render prop. Renders nothing until the first
 * measurement lands (avoids drawing a chart at a wrong size, then
 * snapping — there's exactly one layout pass, not a flash-then-resize).
 *
 * `position: relative` so a `<ChartTooltip>` (interactive/tooltip.tsx),
 * which positions itself `absolute` against its nearest positioned
 * ancestor, has one to anchor to without every chart needing its own
 * wrapper for that. */
export function ResponsiveChart({
  height,
  minWidth = 280,
  className,
  wrapperRef,
  children,
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      wrapperRef?.(el);
    },
    [wrapperRef],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setWidth(Math.max(minWidth, Math.floor(entry.contentRect.width)));
      // Only track measured height when the caller isn't pinning it to a
      // fixed number — a fixed-height chart sizes its own SVG and the
      // container just follows that, so re-measuring here would be
      // circular (and pointless).
      if (height === undefined) {
        setMeasuredHeight(Math.floor(entry.contentRect.height));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [minWidth, height]);

  const resolvedHeight = height ?? measuredHeight;

  return (
    <div
      ref={setRefs}
      className={className}
      style={{ width: "100%", position: "relative", ...(height !== undefined ? { height } : {}) }}
    >
      {width > 0 && resolvedHeight > 0 ? (
        children({ width, height: resolvedHeight })
      ) : (
        <div style={height !== undefined ? { height } : undefined} />
      )}
    </div>
  );
}
