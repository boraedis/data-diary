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
  "Hover a point for its exact value and date. With more than one line, click a legend entry to hide or show that line. The shaded band is ±1 standard deviation around that period's plotted average, drawn only while a single line is visible; marker size shows how many days fed the point. Where a dotted line is drawn, it marks a fixed target (8 hours, say), labelled at its right end.";

/** `InteractiveLine` with `hover="series"`, for charts carrying too many
 * lines for the crosshair's every-line readout (the People Impact Trend). */
export const LINE_SERIES_HOVER_INTERACTION_GUIDE =
  "Hover near a line to pick it out: it's drawn on top, the rest fade, and the readout gives that line's name, date and value. With the chart focused, the left and right arrow keys move through time and up and down move between lines.";

export const SCROLLER_INTERACTION_GUIDE =
  "Scroll or drag directly on the chart to zoom in, or drag the strip below it; double-click to reset. Hover or use the arrow keys to inspect an individual entry. Click a legend entry to hide or show that line or the rolling average. Where a dotted line is drawn, it marks a fixed target (8 hours, say), labelled at its right end.";

export const STRIP_INTERACTION_GUIDE =
  "Each row is one group: the dot is its average, the whiskers its 95% confidence interval, and n how many days it holds. A wide interval means too few days to trust the average yet. Hover a row, or focus the chart and use the up and down arrow keys, for its exact figures. Switch Show to Every day to draw each day behind the averages. The dotted line is the average across every day shown.";

export const HIST_INTERACTION_GUIDE = "Hover a bar for its exact count.";

export const CALENDAR_INTERACTION_GUIDE =
  "Each cell is one day, shaded by its value — hover a cell for the exact figure. Where a day is made of several categories, its colour is their mix, and the tooltip lists what went into it. Use the range picker above to focus on a shorter stretch.";

export const AREA_INTERACTION_GUIDE =
  "Hover or focus a band and use the arrow keys to inspect it. Click a legend entry to hide that category; click it again to bring it back.";

export const NETWORK_INTERACTION_GUIDE =
  "The layout is live: drag a node and its connections follow, let go and it settles back into place. Hover a node for its details; click one to highlight it and its neighbours and zoom in on them, and click another node or the background to move or clear that. With nothing selected, clicking the background fits the whole graph back into view. Scroll or pinch to zoom, drag the background to pan. Names appear on more nodes as you zoom in, and initials inside any node big enough to hold them. Where there’s a legend, click an entry to hide that group — the rest of the graph slides to fill the gap. Where there’s a Play control, it grows the graph month by month from the first logged day — drag the scrubber to see the network as it stood at any month, pick a speed, and drag a node to pause.";

export const RANKED_INTERACTION_GUIDE =
  "Use the pickers above to choose what's ranked, and at what level where there's a choice. Click a column header to sort by it, again to reverse, and a third time (or click #) to return to rank order — the # column always shows the real rank. Every entry is included: more rows load as you scroll. Hover a movement arrow for where that entry stood then and now, a shaded number for its exact value, or a header for what the column measures. On a narrow screen, scroll the table sideways; the rank and name stay pinned.";

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
