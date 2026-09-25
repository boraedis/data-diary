import * as d3 from "d3";
import { MARK_SPECS } from "./marks";

// Horizontal reference lines (#444): a fixed y value drawn across the whole
// plot — "8h of work", "8h of sleep", a weight goal. Shared by
// InteractiveLine and InteractiveScroller rather than written into each,
// since the two primitives otherwise keep their mechanics independent (see
// InteractiveScroller's header) and a target line is chrome, not mechanics:
// it should look identical on both.

export type ReferenceLine = {
  /** The y value the line sits at, in the chart's own units (hours, not
   * minutes, on an hours chart). */
  value: number;
  /** Drawn at the line's right end — "8h target". Keep it short: it
   * shares the plot's top-right corner with the data. */
  label: string;
  /** Defaults to the muted foreground. A target line is context, not a
   * series, so it deliberately doesn't take a categorical slot — passing
   * one would make it read as a fourth line in the legend's palette. */
  color?: string;
};

/** Stable empty default. Primitives list `referenceLines` in their `useD3`
 * deps, so a fresh `[]` default per render would rebuild the SVG on every
 * render — pass a module-level constant (or a memoized array) for the
 * same reason. */
export const NO_REFERENCE_LINES: readonly ReferenceLine[] = [];

/**
 * The values an auto-fit y domain must include so every reference line is
 * on screen.
 *
 * Always included rather than only when the data happens to reach them: a
 * target line is most informative exactly when the data sits well clear of
 * it (a month averaging 6h against an 8h target), and silently dropping
 * the line whenever that happens would hide the answer to the question the
 * line exists to ask. The cost is some squashing when a zoomed-in slice
 * sits far from the target — accepted, since the reader can see why.
 */
export function referenceLineValues(lines: readonly ReferenceLine[]): number[] {
  return lines.map((l) => l.value);
}

/**
 * Draws each line as a dotted horizontal rule with its label right-aligned
 * just above it.
 *
 * Dotted (2,4), not dashed: InteractiveScroller already uses a 5,5 dash in
 * the *series'* own colour for its rolling average, and a target line
 * needs to read as a different kind of thing at a glance. Call this after
 * the axes and before the data so the series paint over it.
 */
export function drawReferenceLines({
  g,
  y,
  innerWidth,
  lines,
}: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  y: d3.ScaleLinear<number, number>;
  innerWidth: number;
  lines: readonly ReferenceLine[];
}): void {
  const [lo, hi] = y.domain();
  for (const line of lines) {
    // A caller-fixed yDomain can exclude the value; drawing it anyway would
    // paint a rule over the axis or outside the plot.
    if (line.value < Math.min(lo, hi) || line.value > Math.max(lo, hi)) continue;
    const py = y(line.value);
    const color = line.color ?? "var(--muted-foreground)";
    const group = g.append("g").attr("aria-hidden", "true");
    group
      .append("line")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", py)
      .attr("y2", py)
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "2,4");
    group
      .append("text")
      .attr("x", innerWidth - 4)
      .attr("y", py - 4)
      .attr("text-anchor", "end")
      .attr("fill", color)
      // A surface-coloured halo so the label stays legible where a series
      // crosses it, the same job MARK_SPECS.marker.ringWidth does for dots.
      .attr("stroke", "var(--card)")
      .attr("stroke-width", 3)
      .attr("paint-order", "stroke")
      .style("font-size", MARK_SPECS.axis.tickFontSize)
      .text(line.label);
  }
}
