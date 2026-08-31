"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { drawStandardAxes } from "./axis";
import { MARK_SPECS, attachMarkHover, roundedBarPath } from "./marks";
import { ChartTooltip } from "./tooltip";
import { categoricalColor } from "@/lib/viz/color";

// InteractiveHist (#20) — the shared distribution-histogram primitive.
// The simplest of the core Interactive* primitives: generalizes
// HistogramChart (already close to this shape pre-#20 — d3.bin with
// domain-meaningful fixed thresholds, the toolkit's mark specs and hover
// pattern were already wired in as part of #17) into a reusable component
// with configurable bins/domain/color instead of a single one-off chart.
// Deliberately no zoom/brush here — a histogram's x-axis is a value
// range, not a timeline, so InteractiveLine's zoom vocabulary doesn't
// apply.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 36 };

type Bin = d3.Bin<number, number>;
type Hovered = { bin: Bin; clientPos: { x: number; y: number } };

export type InteractiveHistProps = {
  values: number[];
  width: number;
  height: number;
  /** Explicit bucket edges, matching d3.bin's own `.thresholds()` — e.g.
   * `d3.range(0, 101, 10)` for one bucket per 10 points on a 0-100 scale.
   * Omit for d3.bin's own Sturges-rule default bucket count, the right
   * choice when the buckets aren't domain-meaningful. */
  thresholds?: number[];
  /** Domain to bin over — omit to auto-domain from `values`' own extent
   * (d3.bin's default). Pass this explicitly for a domain-meaningful fixed
   * scale (0-100 happiness) rather than a data-dependent one, so a narrow
   * or sparse dataset doesn't zoom the axis in on itself. */
  domain?: [number, number];
  /** Bar fill — a single color (default: `categoricalColor(0)`) or a
   * function shading each bar by its own bucket (e.g. `viz/color`'s
   * `sequentialScale`, for a caller that wants magnitude read through
   * color as well as height). */
  color?: string | ((bin: Bin, index: number) => string);
  xTicks?: number;
  yTicks?: number;
  /** Formats a bucket's `[x0, x1)` range for the tooltip row label —
   * defaults to `"x0–x1"`. */
  formatRange?: (x0: number, x1: number) => string;
  ariaLabel?: string;
  margin?: Partial<typeof DEFAULT_MARGIN>;
};

export function InteractiveHist({
  values,
  width,
  height,
  thresholds,
  domain,
  color,
  xTicks,
  yTicks = 5,
  formatRange = (x0, x1) => `${x0}–${x1}`,
  ariaLabel = "Distribution histogram. Hover a bar to see its range and count.",
  margin,
}: InteractiveHistProps) {
  const MARGIN = { ...DEFAULT_MARGIN, ...margin };
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const bins = useMemo(() => {
    let binGen = d3.bin();
    if (domain) binGen = binGen.domain(domain);
    if (thresholds) binGen = binGen.thresholds(thresholds);
    return binGen(values);
  }, [values, domain, thresholds]);

  // When `domain` isn't given, d3.bin still resolves *some* domain from
  // the data internally (and stamps it onto the first/last bin's own
  // x0/x1) — read it back from the bins rather than re-deriving
  // `d3.extent(values)` ourselves, so the x-axis always matches exactly
  // what the bars were actually bucketed against.
  const xDomain = useMemo<[number, number]>(
    () => domain ?? [bins[0]?.x0 ?? 0, bins[bins.length - 1]?.x1 ?? 1],
    [domain, bins],
  );

  const [hovered, setHovered] = useState<Hovered | null>(null);
  // A state-backed callback ref, not a plain useRef — the container's
  // getBoundingClientRect() below needs to be read during render (to
  // position the tooltip relative to the container from a hover's
  // *client* coordinates), and reading a plain ref's `.current` during
  // render is exactly what React (and this project's lint rule) warns
  // against; a state value read during render is the normal, correct
  // pattern for this.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const x = d3.scaleLinear().domain(xDomain).range([0, innerWidth]);
      const y = d3
        .scaleLinear()
        .domain([0, d3.max(bins, (b) => b.length) ?? 0])
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      drawStandardAxes({ g, x, y, innerWidth, innerHeight, xTicks, yTicks });

      const bars = g
        .selectAll("path")
        .data(bins)
        .join("path")
        .attr("d", (d) => {
          const slotX0 = x(d.x0 ?? 0);
          const slotX1 = x(d.x1 ?? 0);
          // Cap thickness rather than filling the slot — the leftover
          // width becomes air on both sides, not a wider bar.
          const slotWidth = Math.max(0, slotX1 - slotX0 - MARK_SPECS.bar.surfaceGap);
          const barWidth = Math.min(slotWidth, MARK_SPECS.bar.maxThickness);
          const barX = slotX0 + (slotX1 - slotX0 - barWidth) / 2;
          const barHeight = innerHeight - y(d.length);
          return roundedBarPath(barX, y(d.length), barWidth, barHeight, "up");
        })
        .attr("fill", (d, i) => (typeof color === "function" ? color(d, i) : (color ?? categoricalColor(0))));

      attachMarkHover<Bin>(bars, {
        onHover: (bin, clientPos) => setHovered({ bin, clientPos }),
        onLeave: () => setHovered(null),
      });
    },
    [bins, xDomain, width, height, innerWidth, innerHeight, xTicks, yTicks, color],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredColor = hovered
    ? typeof color === "function"
      ? color(hovered.bin, bins.indexOf(hovered.bin))
      : (color ?? categoricalColor(0))
    : undefined;

  return (
    <div ref={setContainerEl} style={{ position: "relative", width, height }} role="img" aria-label={ariaLabel}>
      <svg ref={ref} />
      {hovered && containerRect ? (
        <ChartTooltip
          x={hovered.clientPos.x - containerRect.left}
          y={hovered.clientPos.y - containerRect.top}
          rows={[
            {
              label: formatRange(hovered.bin.x0 ?? 0, hovered.bin.x1 ?? 0),
              value: `${hovered.bin.length}`,
              color: hoveredColor ?? categoricalColor(0),
            },
          ]}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
