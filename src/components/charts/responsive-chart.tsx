"use client";

import { useEffect, useRef, useState } from "react";

type ResponsiveChartProps = {
  /** Fixed chart height in px — only width is responsive. Every legacy
   * chart hardcoded both width and height from window.innerWidth/Height at
   * load time with no resize handling at all; this component is the fix,
   * so every chart built on top of it gets real responsiveness for free. */
  height: number;
  minWidth?: number;
  className?: string;
  children: (dimensions: { width: number; height: number }) => React.ReactNode;
};

/** Measures its container's width via ResizeObserver and passes
 * {width, height} to `children` as a render prop. Renders nothing until the
 * first measurement lands (avoids drawing a chart at a wrong width, then
 * snapping — there's exactly one layout pass, not a flash-then-resize). */
export function ResponsiveChart({
  height,
  minWidth = 280,
  className,
  children,
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

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
    <div ref={containerRef} className={className} style={{ width: "100%" }}>
      {width > 0 ? children({ width, height }) : <div style={{ height }} />}
    </div>
  );
}
