"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

/** Runs a D3 render function against an <svg> ref whenever `deps` change,
 * clearing the SVG's contents first every time. This mirrors the legacy
 * app's own approach (every chart in `vis_functions.js` does
 * `document.getElementById(...).remove()` then rebuilds from scratch on
 * every call) rather than a proper D3 enter/update/exit join — that's the
 * right tradeoff here too: our charts re-render on a full data/dimensions
 * change (a resize, a brush selection), not frame-by-frame, so there's no
 * transition state worth preserving between renders.
 *
 * `renderFn` receives the live D3 selection for the <svg> element; do all
 * drawing by appending to it (or a `<g>` inside it). Returning a cleanup
 * function from `renderFn` is optional — use it for anything with a
 * lifecycle *outside* the SVG's own DOM (e.g. a d3-zoom behavior's event
 * listeners), since clearing the SVG's children doesn't reach those.
 */
export function useD3<T extends SVGSVGElement>(
  renderFn: (svg: d3.Selection<T, unknown, null, undefined>) => void | (() => void),
  deps: React.DependencyList,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const svg = d3.select(node);
    svg.selectAll("*").remove();
    const cleanup = renderFn(svg);
    return () => {
      cleanup?.();
    };
    // renderFn is intentionally excluded — callers pass an inline closure
    // each render, so including it would defeat the deps list entirely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
