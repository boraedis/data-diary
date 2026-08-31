import * as d3 from "d3";
import { MARK_SPECS } from "./marks";

// Shared axis-drawing helper (#17's "shared axis/margin helper" scope
// item). Before this, histogram-chart.tsx, happiness-averager-chart.tsx,
// weight-scroller-chart.tsx, and gym-weight-combo-chart.tsx each hand-
// rolled the identical `.call(axis => axis.selectAll("text")...)` /
// `.call(axis => axis.selectAll("line,path")...)` pair after every
// `d3.axisBottom`/`d3.axisLeft` call — this centralizes that styling so a
// palette or spec change (MARK_SPECS.axis) only has to happen once.

/**
 * Applies the app's standard axis chrome (recessive muted tick text,
 * `var(--border)` lines/path, MARK_SPECS.axis sizing) to an already-
 * constructed d3 axis, rendering it into `axisG`. `axisG` should already
 * be positioned (translated) where the axis belongs — this only draws and
 * styles, it doesn't position the group.
 */
export function styleAxis<Domain extends d3.AxisDomain>(
  axisG: d3.Selection<SVGGElement, unknown, null, undefined>,
  axis: d3.Axis<Domain>,
  options?: { textColor?: string },
): d3.Selection<SVGGElement, unknown, null, undefined> {
  axisG
    .call(axis)
    .call((g) =>
      g
        .selectAll("text")
        .attr("fill", options?.textColor ?? "var(--muted-foreground)")
        .style("font-size", MARK_SPECS.axis.tickFontSize),
    )
    .call((g) =>
      g
        .selectAll("line,path")
        .attr("stroke", "var(--border)")
        .attr("stroke-width", MARK_SPECS.axis.strokeWidth),
    );
  return axisG;
}

/**
 * Draws faint horizontal gridlines across the plot, one per y-axis tick —
 * the standard idiomatic d3 technique (a left axis whose ticks are drawn
 * as full-width lines via `tickSize(-innerWidth)` instead of a few px,
 * with its own tick text and domain path hidden) rather than hand-
 * computing tick positions again from the same scale. Shared/reusable —
 * any chart with a linear y-axis can call this, not just InteractiveArea
 * (its first caller, #19 follow-up feedback: "add horizontal grid line").
 *
 * Call this BEFORE the real axis/data (append order is paint order in
 * SVG) so gridlines sit visually behind everything else.
 */
export function drawYGridlines({
  g,
  y,
  innerWidth,
  ticks,
}: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  y: d3.AxisScale<d3.NumberValue>;
  innerWidth: number;
  ticks?: number;
}): d3.Selection<SVGGElement, unknown, null, undefined> {
  const gridG = g.append("g").attr("aria-hidden", "true");
  gridG
    .call(d3.axisLeft(y).ticks(ticks ?? 5).tickSize(-innerWidth).tickFormat(() => ""))
    .call((sel) => sel.select(".domain").remove())
    .call((sel) => sel.selectAll("line").attr("stroke", "var(--border)").attr("stroke-opacity", 0.6));
  return gridG;
}

/**
 * Draws a standard bottom + left axis pair inside `g` (already translated
 * to the chart's inner origin) — the common single-axis case every chart
 * in this codebase except gym-weight-combo-chart.tsx needs. A dual-axis
 * chart should call `styleAxis` directly per axis instead of this — see
 * that file's own comment on why a second y-axis isn't a pattern to
 * extend (the dataviz skill's #1 non-negotiable: never a dual-axis
 * chart).
 */
export function drawStandardAxes({
  g,
  x,
  y,
  innerWidth,
  innerHeight,
  xTicks,
  yTicks,
  yTickFormat,
}: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  x: d3.AxisScale<d3.NumberValue> | d3.AxisScale<Date>;
  y: d3.AxisScale<d3.NumberValue>;
  innerWidth: number;
  innerHeight: number;
  xTicks?: number;
  yTicks?: number;
  yTickFormat?: (domainValue: d3.NumberValue, index: number) => string;
}): {
  xAxisG: d3.Selection<SVGGElement, unknown, null, undefined>;
  yAxisG: d3.Selection<SVGGElement, unknown, null, undefined>;
} {
  // Matches the adaptive tick count every chart file already computed by
  // hand (roughly one tick per 90px of plot width) rather than a flat
  // default, so ticks don't crowd on a narrow chart or thin out on a wide
  // one.
  const resolvedXTicks = xTicks ?? Math.max(2, Math.floor(innerWidth / 90));

  const xAxisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
  styleAxis(xAxisG, d3.axisBottom(x as d3.AxisScale<d3.AxisDomain>).ticks(resolvedXTicks));

  const yAxis = d3.axisLeft(y).ticks(yTicks ?? 5);
  if (yTickFormat) yAxis.tickFormat(yTickFormat);
  const yAxisG = g.append("g");
  styleAxis(yAxisG, yAxis);

  return { xAxisG, yAxisG };
}
