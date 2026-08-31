"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ResponsiveChartProps = {
  /** Fixed chart height in px — only width is responsive. Every legacy
   * chart hardcoded both width and height from window.innerWidth/Height at
   * load time with no resize handling at all; this component is the fix,
   * so every chart built on top of it gets real responsiveness for free. */
  height: number;
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

/** Measures its container's width via ResizeObserver and passes
 * {width, height} to `children` as a render prop. Renders nothing until the
 * first measurement lands (avoids drawing a chart at a wrong width, then
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
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [minWidth]);

  return (
    <div ref={setRefs} className={className} style={{ width: "100%", position: "relative" }}>
      {width > 0 ? children({ width, height }) : <div style={{ height }} />}
    </div>
  );
}
