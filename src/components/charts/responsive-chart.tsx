"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fallback/floor className for a `fillViewport` chart, applied before its
 * real height lands (server render, first paint, or JS disabled) so there
 * is never a zero-height flash. `fillViewport`'s own measurement (see
 * below) replaces this with an inline pixel height once it runs; without
 * JS, this is what the chart is stuck at.
 */
export const CHART_HEIGHT_CLASS = "min-h-[320px]";

/** `fillViewport`'s floor — never size a chart shorter than this even if
 * the measured available space comes out smaller (a lot of chrome above
 * it on a short screen). The chart overflows the viewport a little
 * instead of being crushed unreadable. */
const FILL_VIEWPORT_MIN_HEIGHT = 320;

/**
 * `fillViewport`'s bottom margin, in px — deliberately generous rather
 * than trying to re-derive the exact padding stack below the chart
 * (`ChartCard`'s own bottom `--card-spacing` plus `ChartPage`'s `main`
 * bottom padding, whichever call site this chart is inside). Erring high
 * costs a few px of otherwise-usable height; erring low means the card's
 * own bottom padding pushes past the viewport's bottom edge, which reads
 * as broken. Not worth the coupling a pixel-perfect version would need
 * between this file and every page's own padding choices.
 */
const FILL_VIEWPORT_BOTTOM_MARGIN = 48;

/** `fillViewport="below-filters"`'s gap between the sticky nav and the
 * filters row once scrolled into place — the same breathing room the page
 * gives the filters row below the title before scrolling. */
const BELOW_FILTERS_TOP_GAP = 16;

type ResponsiveChartProps = {
  /** Fixed chart height in px — use this for a chart whose height should
   * come from its own content (a calendar's row count, a small-multiples
   * grid's mini-chart size), not from available screen space. */
  height?: number;
  /**
   * Measures how far this chart's own top sits from the viewport's top
   * edge (`getBoundingClientRect().top`, not a CSS percentage/flex
   * computation) and sizes the chart to fill what's left of the screen
   * below that point, minus `FILL_VIEWPORT_BOTTOM_MARGIN` — so the chart
   * fills the screen regardless of how much "chrome" (nav bar, page
   * title, description, filters row) happens to render above it on a
   * given page, without this component or its caller needing to know any
   * of those heights. Real DOM measurement rather than a CSS `height:
   * 100%`/`flex: 1` chain deliberately: the latter needs every ancestor
   * between this element and the viewport to resolve a definite height
   * correctly, which turned out fragile in practice across `ChartPage`,
   * `ChartCard`, and the root layout's own flex setup — this is the
   * "measure the one number that actually matters" alternative. Re-runs
   * on window resize and on this element's own position shifting (e.g. a
   * filters row wrapping to a second line changes the chart's top offset
   * without the window itself resizing). Ignored when `height` is set.
   *
   * `"below-filters"` (#437 follow-up, the people network) sizes for the
   * page *scrolled*, rather than as it first loads: the chart is made just
   * tall enough that once the title and description scroll up under the
   * sticky nav, the `ChartPage` filters row, the card and the chart
   * together fill exactly the rest of the screen. It measures the chart's
   * offset below the filters row (`[data-chart-filters]`) instead of below
   * the viewport's top edge, and subtracts the sticky nav
   * (`[data-sticky-nav]`) and anything the caller renders below the chart
   * in the same parent. The chart ends up taller than `true` gives it;
   * the cost is that on load its bottom sits below the fold, which is the
   * point — a short scroll trades the page header for a full-screen chart
   * and its controls. Falls back to `true`'s behaviour on a page with no
   * filters row.
   */
  fillViewport?: boolean | "below-filters";
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
  fillViewport = false,
  minWidth = 280,
  className,
  wrapperRef,
  children,
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [viewportFillHeight, setViewportFillHeight] = useState(0);

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
      // fixed number or filling the viewport — a fixed-height chart sizes
      // its own SVG and the container just follows that, and a
      // fillViewport chart's height comes from the effect below instead;
      // re-measuring the container's own (not-yet-sized) height here
      // would be circular in both cases.
      if (height === undefined && !fillViewport) {
        setMeasuredHeight(Math.floor(entry.contentRect.height));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [minWidth, height, fillViewport]);

  useEffect(() => {
    if (!fillViewport) return;
    const el = containerRef.current;
    if (!el) return;
    function recompute() {
      const top = el!.getBoundingClientRect().top;
      let available = window.innerHeight - top - FILL_VIEWPORT_BOTTOM_MARGIN;
      if (fillViewport === "below-filters") {
        // Offset *within the page*, not from the viewport's top, so the
        // result doesn't change as the page scrolls.
        const anchor = el!.closest("main")?.querySelector("[data-chart-filters]");
        if (anchor) {
          const offset = top - anchor.getBoundingClientRect().top;
          const nav = document.querySelector("[data-sticky-nav]")?.getBoundingClientRect().height ?? 0;
          // Room for whatever the caller renders under the chart in the
          // same container (the people network's playback row): the
          // distance from this element's bottom to its parent's, which
          // doesn't depend on this element's own height.
          const parent = el!.parentElement;
          const below = parent ? parent.getBoundingClientRect().bottom - el!.getBoundingClientRect().bottom : 0;
          available =
            window.innerHeight - nav - BELOW_FILTERS_TOP_GAP - offset - below - FILL_VIEWPORT_BOTTOM_MARGIN;
        }
      }
      setViewportFillHeight(Math.max(FILL_VIEWPORT_MIN_HEIGHT, Math.floor(available)));
    }
    recompute();
    window.addEventListener("resize", recompute);
    // Catches this element's own top offset moving without a window
    // resize — a filters row wrapping to a second line, the description
    // line appearing/disappearing, etc. `document.body` rather than `el`
    // itself: `el`'s own size is what we're setting, so observing it
    // would just re-trigger on our own writes.
    const observer = new ResizeObserver(recompute);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("resize", recompute);
      observer.disconnect();
    };
  }, [fillViewport]);

  const resolvedHeight = height ?? (fillViewport ? viewportFillHeight : measuredHeight);

  return (
    <div
      ref={setRefs}
      className={className}
      style={{
        width: "100%",
        position: "relative",
        ...(height !== undefined || (fillViewport && resolvedHeight > 0) ? { height: resolvedHeight } : {}),
      }}
    >
      {width > 0 && resolvedHeight > 0 ? (
        children({ width, height: resolvedHeight })
      ) : (
        <div style={height !== undefined ? { height } : undefined} />
      )}
    </div>
  );
}
