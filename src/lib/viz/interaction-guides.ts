/**
 * Generic, primitive-level interaction-guide copy for the `ChartInfo`
 * details popup (#315). Interaction mechanics are a property of the
 * *primitive* a chart is built on, not of the individual chart — every
 * `InteractiveLine` chart supports the same hover/zoom regardless of what
 * it plots — so this is one paragraph per primitive, reused across every
 * chart built on it, rather than copy repeated (and drifting) per page.
 *
 * Per-chart wording (what a chart actually shows, how a value is derived)
 * is separate — see `PLACEHOLDER_METHODOLOGY` below and #316, the content
 * follow-up ticket that replaces these placeholders with real per-chart
 * copy once the popup itself is live.
 */

export const LINE_INTERACTION_GUIDE =
  "Hover a point for its exact value and date. The shaded band (where shown) is that period's day-to-day range around the plotted average; marker size shows how many days fed the point.";

export const SCROLLER_INTERACTION_GUIDE =
  "Scroll or drag directly on the chart to zoom in, or drag the strip below it; double-click to reset. Hover or use the arrow keys to inspect an individual entry.";

export const HIST_INTERACTION_GUIDE = "Hover a bar for its exact count.";

export const CALENDAR_INTERACTION_GUIDE =
  "Each cell is one day, shaded by its value — hover a cell for the exact figure. Use the range picker above to focus on a shorter stretch.";

export const AREA_INTERACTION_GUIDE =
  "Hover or focus a band and use the arrow keys to inspect it. Click a legend entry to hide that category; click it again to bring it back.";

export const NETWORK_INTERACTION_GUIDE =
  "Scroll or pinch to zoom, drag the background to pan. Drag a node to reposition it, or click one to highlight its connections.";

export const RANKED_INTERACTION_GUIDE =
  "Hover a row for its detail. Use the controls above to change how many entries are shown.";

export const DONUT_INTERACTION_GUIDE =
  "Click a slice to zoom into it; click the center (or press Escape) to zoom back out. Hover a slice for its exact value.";

export const GEO_INTERACTION_GUIDE =
  "Scroll or pinch to zoom, drag to pan. Click a region to drill into it where that's available; hover a region or marker for its exact value, or for what's known about it where there's no figure to show.";

export const BAR_RACE_INTERACTION_GUIDE =
  "Use the playback controls to run, pause, or scrub the animation. Hover a bar for its exact value at that point in time.";

export const COMBO_INTERACTION_GUIDE =
  "Hover a point or bar for its exact value and date.";

export const TIMELINE_INTERACTION_GUIDE =
  "Drag the period slider or scroll the chart to zoom, drag to pan. Hover or focus an entry for its dates and length.";

/** Shown in the popup's Methodology section until a chart has real,
 * hand-written copy from #316 — the content follow-up ticket. Deliberately
 * visible rather than hidden, so a placeholder reads as "not written yet"
 * instead of silently missing. */
export const PLACEHOLDER_METHODOLOGY =
  "Methodology write-up pending — see issue #316.";
