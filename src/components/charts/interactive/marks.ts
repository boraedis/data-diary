import * as d3 from "d3";

// Fixed mark specs shared by every chart primitive (#17's "mark-spec
// constants module" scope item) — the dataviz skill's marks-and-anatomy.md
// numbers, in one place instead of re-typed per chart file. Before this,
// every chart file re-typed its own `2` (line stroke width), `"11px"`
// (axis tick font), and `var(--border)` (axis color) by hand — real
// duplication (see histogram-chart.tsx, happiness-averager-chart.tsx,
// weight-scroller-chart.tsx, gym-weight-combo-chart.tsx before this PR),
// and the kind of thing that quietly drifts chart-to-chart. New chart
// primitives should read from here, not re-type a number.
export const MARK_SPECS = {
  line: {
    /** Line stroke width, px. */
    strokeWidth: 2,
  },
  marker: {
    /** Marker/end-dot radius, px (>= 4, i.e. >= 8px diameter). */
    radius: 4,
    /** Surface-color ring around a marker, so it stays legible crossing a
     * line or overlapping another marker — part of the marker's hover/hit
     * target, not just visual spacing (see interaction.md). */
    ringWidth: 2,
  },
  area: {
    /** Area fill opacity — a wash, never a saturated block. */
    fillOpacity: 0.1,
  },
  bar: {
    /** Cap on thickness, px — never fill the whole band; let the band's
     * leftover be air. */
    maxThickness: 24,
    /** Radius at the data-end only; the baseline end stays square. */
    dataEndRadius: 4,
    /** Surface-color gap between touching bars/segments (every segment of
     * a stack, every adjacent bar) — the mechanism that separates
     * neighbors, instead of a stroke drawn around them. */
    surfaceGap: 2,
  },
  axis: {
    strokeWidth: 1,
    tickFontSize: "11px",
  },
  hover: {
    /** Minimum hit-target size, px, for a mark smaller than this (a
     * calendar cell, a scatter dot) — the painted mark itself is often
     * smaller; the hit area is what matters, not the paint. */
    minHitTarget: 24,
    /** Opacity a mark eases toward on hover/focus — a "lift" (lighten),
     * not a color change, so identity doesn't shift on interaction. */
    liftOpacity: 0.7,
  },
} as const;

/**
 * SVG path `d` for a bar rounded only at its data-end, square at the
 * baseline (marks-and-anatomy.md: "4px rounded data-end, square at the
 * baseline") — `<rect rx>` rounds all four corners, which is the wrong
 * shape for a bar chart; this is the fix every bar-drawing chart should
 * use instead of a plain `rect`.
 *
 * `direction` is which way the bar *grows* away from its baseline:
 * "up"/"down" for a vertical column, "right"/"left" for a horizontal bar.
 */
export function roundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  direction: "up" | "down" | "right" | "left" = "up",
  radius: number = MARK_SPECS.bar.dataEndRadius,
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  switch (direction) {
    case "up":
      return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
    case "down":
      return `M${x},${y} H${x + width} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x + r} Q${x},${y + height} ${x},${y + height - r} Z`;
    case "right":
      return `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x} Z`;
    case "left":
      return `M${x + width},${y} H${x + r} Q${x},${y} ${x},${y + r} V${y + height - r} Q${x},${y + height} ${x + r},${y + height} H${x + width} Z`;
  }
}

/**
 * Attaches the standard per-mark hover/focus treatment to a d3 selection
 * of individual marks (bars, dots, cells): keyboard-focusable, lifts
 * opacity on pointerenter/focus, calls back with the datum + client
 * position so the caller can drive a `<ChartTooltip>` from React state.
 * This is the "no crosshair — each mark is its own hit target" half of
 * interaction.md; see tooltip.tsx's `useCrosshair` for the line/area half.
 *
 * Does NOT enlarge the visual mark to `MARK_SPECS.hover.minHitTarget` —
 * for marks already >= that size (most bars) the painted shape is already
 * a big enough target. For marks smaller than that (calendar cells,
 * scatter points), the caller should size the invisible hit area itself
 * (e.g. a transparent `<rect>`/`<circle>` sized to at least
 * `MARK_SPECS.hover.minHitTarget`) and pass that selection here — this
 * helper only wires up the interaction, not the geometry.
 */
export function attachMarkHover<Datum>(
  selection: d3.Selection<d3.BaseType, Datum, d3.BaseType, unknown>,
  options: {
    onHover: (datum: Datum, clientPos: { x: number; y: number }) => void;
    onLeave: () => void;
    /** CSS property eased on hover — defaults to fill-opacity, since most
     * marks here are filled shapes. Pass "opacity" for a stroked mark. */
    property?: "fill-opacity" | "opacity";
  },
): void {
  const property = options.property ?? "fill-opacity";
  selection
    .attr("tabindex", 0)
    .style("cursor", "pointer")
    .style("outline", "none")
    .on("pointerenter pointermove focus", function (event: Event, d: Datum) {
      d3.select(this).style(property, String(MARK_SPECS.hover.liftOpacity));
      const clientPos =
        event instanceof PointerEvent
          ? { x: event.clientX, y: event.clientY }
          : (() => {
              const rect = (this as Element).getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top };
            })();
      options.onHover(d, clientPos);
    })
    .on("pointerleave blur", function () {
      d3.select(this).style(property, null);
      options.onLeave();
    });
}
