"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { DEFAULT_FOCUS_DURATION_MS, lerpDomain, resolveInitialFocus, type InitialFocus } from "@/lib/viz/initial-focus";

/** Input that means the reader has taken over — any of these stops the
 * tween where it is, so it never fights a drag, a wheel turn or the period
 * slider. Window-level and capturing because the chart's own d3-zoom
 * listeners call stopImmediatePropagation, which would hide the event from
 * a handler on the same element. */
const TAKEOVER_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart"] as const;

/**
 * Opens a zoomable time chart zoomed out and animates it into `focus`
 * (#565). Runs once, the first time there is data to zoom — a later change
 * to the series (a unit switch, a region toggle) must not yank the reader
 * back to the recent window they've already left.
 *
 * `onDomain` receives each frame's visible window. Frames go through the
 * chart's own domain state, so d3-zoom's transform, the minimap brush and
 * the period slider all follow with no extra wiring. The reader's first
 * input (see TAKEOVER_EVENTS) stops the animation at its current frame, and
 * `prefers-reduced-motion` skips straight to the final window.
 *
 * Pass `full` as a memoized value (it's an effect dependency).
 */
export function useInitialFocus(
  full: readonly [Date, Date] | null,
  focus: InitialFocus | null | undefined,
  onDomain: (domain: [Date, Date]) => void,
) {
  const onDomainRef = useRef(onDomain);
  useEffect(() => {
    onDomainRef.current = onDomain;
  });
  // True once the animation has finished, been skipped or been taken over
  // by the reader — only then does a later change to `full` stay put.
  const done = useRef(false);

  // `focus` is read once, at start; a new object identity per render must
  // not restart anything, so it lives in a ref rather than the dependencies.
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  });

  useEffect(() => {
    const spec = focusRef.current;
    if (done.current || !full || !spec) return;
    const target = resolveInitialFocus(full, spec);
    if (!target) {
      // A degenerate `full` (no data yet) isn't a verdict — data may arrive.
      if (full[1] > full[0]) done.current = true;
      return;
    }

    const duration = spec.durationMs ?? DEFAULT_FOCUS_DURATION_MS;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (duration <= 0 || reduced) {
      done.current = true;
      onDomainRef.current(target);
      return;
    }

    let raf = 0;
    const begin = performance.now();
    const detach = () => {
      cancelAnimationFrame(raf);
      for (const type of TAKEOVER_EVENTS) window.removeEventListener(type, takeover, true);
    };
    const takeover = () => {
      done.current = true;
      detach();
    };
    for (const type of TAKEOVER_EVENTS) window.addEventListener(type, takeover, { capture: true, passive: true });

    const frame = (now: number) => {
      const t = Math.min(1, (now - begin) / duration);
      onDomainRef.current(lerpDomain(full, target, d3.easeCubicInOut(t)));
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        done.current = true;
        detach();
      }
    };
    raf = requestAnimationFrame(frame);

    // Cleanup only detaches, it doesn't mark `done`: React strict mode runs
    // this effect twice in dev and the second pass has to restart the tween.
    return detach;
  }, [full]);
}
