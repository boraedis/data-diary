"use client";

import { useEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";

// InteractiveBump — a ranking over time as ribbons: one column per period,
// one ribbon per item, rank 1 at the top, ribbons weaving past each other
// where an item overtakes another. Built for the ranking ribbon (#222's
// `top_movie_ribbon`), where the question is "how did my favourites shift",
// and shaped for any ranked series — the same data a bar race animates, laid
// out all at once.
//
// Ribbons are drawn with `curveBumpX`, which holds each point flat and eases
// between columns, so a crossing reads as a deliberate swap rather than a
// diagonal scribble. An item that leaves the ranking and returns draws as
// two separate runs (a gap means "not ranked then", not a ribbon through
// the middle of someone else's rank). Hovering a ribbon dims the rest.
//
// Labels sit at the two ends — an item's name beside its rank in the first
// column and in the last — which is where the eye looks for "who started
// here" and "who's here now". Items that came and went in between have no
// room for a label and are named by the tooltip instead (hover or focus).
// Below `LABEL_MIN_WIDTH` the end labels are dropped entirely, so on a
// phone the plot gets the width and the tooltip does the naming.

export type InteractiveBumpSeries = {
  id: string;
  label: string;
  color: string;
  /** Rank per column, 1 = best, null where the item wasn't ranked. */
  ranks: (number | null)[];
};

export type InteractiveBumpProps = {
  columns: string[];
  series: InteractiveBumpSeries[];
  /** The deepest rank drawn — the list's length, so the axis is fixed
   * rather than shrinking when a quiet year only ranks a few. */
  maxRank: number;
  width: number;
  height: number;
  ariaLabel: string;
};

const LABEL_MIN_WIDTH = 520;
const LABEL_MARGIN = 150;
const LABEL_FONT_PX = 12;
const MARGIN = { top: 20, bottom: 28 };
const RANK_AXIS_WIDTH = 24;
const RIBBON_WIDTH = 8;
const DOT_RADIUS = 5;
const DIM_OPACITY = 0.15;

/** Truncates to a rough pixel budget — no text measurement inside a render
 * pass, the same trade-off InteractiveStrip makes for its label margin. */
function truncate(label: string, maxPx: number): string {
  const maxChars = Math.max(4, Math.floor(maxPx / (LABEL_FONT_PX * 0.55)));
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1)}…`;
}

/** Contiguous stretches of non-null ranks, as [columnIndex, rank] runs. */
function runsOf(ranks: (number | null)[]): [number, number][][] {
  const runs: [number, number][][] = [];
  let current: [number, number][] = [];
  ranks.forEach((rank, i) => {
    if (rank === null) {
      if (current.length) runs.push(current);
      current = [];
    } else current.push([i, rank]);
  });
  if (current.length) runs.push(current);
  return runs;
}

export function InteractiveBump({ columns, series, maxRank, width, height, ariaLabel }: InteractiveBumpProps) {
  const showLabels = width >= LABEL_MIN_WIDTH;
  const marginLeft = RANK_AXIS_WIDTH + (showLabels ? LABEL_MARGIN : 8);
  const marginRight = showLabels ? LABEL_MARGIN : 16;
  const innerWidth = Math.max(0, width - marginLeft - marginRight);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const x = useMemo(
    () =>
      // One column has nowhere to spread to, so it sits in the middle.
      columns.length === 1
        ? () => innerWidth / 2
        : d3.scalePoint<number>().domain(columns.map((_, i) => i)).range([0, innerWidth]),
    [columns, innerWidth],
  );
  const y = useMemo(
    () => d3.scaleLinear().domain([1, Math.max(2, maxRank)]).range([DOT_RADIUS + 4, innerHeight - DOT_RADIUS - 4]),
    [maxRank, innerHeight],
  );

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", height);
      const g = svg.append("g").attr("transform", `translate(${marginLeft},${MARGIN.top})`);

      // A faint line and a number per rank: with ribbons crossing, position
      // alone doesn't tell you "this is #4".
      for (let rank = 1; rank <= maxRank; rank++) {
        g.append("line")
          .attr("x1", 0)
          .attr("x2", innerWidth)
          .attr("y1", y(rank))
          .attr("y2", y(rank))
          .attr("stroke", "var(--border)")
          .attr("stroke-opacity", 0.5)
          .attr("aria-hidden", "true");
        svg
          .append("text")
          .attr("x", RANK_AXIS_WIDTH - 6)
          .attr("y", MARGIN.top + y(rank))
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", MARK_SPECS.axis.tickFontSize)
          .text(rank);
      }

      columns.forEach((label, i) => {
        g.append("text")
          .attr("x", x(i) as number)
          .attr("y", innerHeight + 18)
          .attr("text-anchor", "middle")
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", MARK_SPECS.axis.tickFontSize)
          .text(label);
      });

      const line = d3
        .line<[number, number]>()
        .x((d) => x(d[0]) as number)
        .y((d) => y(d[1]))
        .curve(d3.curveBumpX);

      for (const s of series) {
        const item = g.append("g").attr("data-series", s.id).attr("class", "bump-series");
        for (const run of runsOf(s.ranks)) {
          if (run.length > 1) {
            item
              .append("path")
              .attr("d", line(run))
              .attr("fill", "none")
              .attr("stroke", s.color)
              .attr("stroke-width", RIBBON_WIDTH)
              .attr("stroke-linecap", "round")
              .attr("stroke-opacity", 0.85);
          }
          for (const [col, rank] of run) {
            item
              .append("circle")
              .attr("cx", x(col) as number)
              .attr("cy", y(rank))
              .attr("r", DOT_RADIUS)
              .attr("fill", s.color)
              .attr("stroke", "var(--card)")
              .attr("stroke-width", MARK_SPECS.marker.ringWidth);
          }
        }
      }

      if (showLabels) {
        const last = columns.length - 1;
        for (const s of series) {
          const first = s.ranks[0];
          if (first !== null && first !== undefined) {
            g.append("text")
              .attr("data-series", s.id)
              .attr("class", "bump-series")
              .attr("x", (x(0) as number) - 12)
              .attr("y", y(first))
              .attr("dy", "0.35em")
              .attr("text-anchor", "end")
              .attr("fill", "var(--foreground)")
              .style("font-size", `${LABEL_FONT_PX}px`)
              .text(truncate(s.label, LABEL_MARGIN - 16));
          }
          // A single column is both "first" and "last" — labelled once, on the left.
          const end = s.ranks[last];
          if (last > 0 && end !== null && end !== undefined) {
            g.append("text")
              .attr("data-series", s.id)
              .attr("class", "bump-series")
              .attr("x", (x(last) as number) + 12)
              .attr("y", y(end))
              .attr("dy", "0.35em")
              .attr("fill", "var(--foreground)")
              .style("font-size", `${LABEL_FONT_PX}px`)
              .text(truncate(s.label, LABEL_MARGIN - 16));
          }
        }
      }
    },
    [columns, series, maxRank, width, height, marginLeft, innerWidth, innerHeight, x, y, showLabels],
  );

  // Hover/focus is React state driving the tooltip and a restyle-only
  // effect, never a `useD3` dependency (AGENTS.md: per-pointer state must
  // not rebuild the SVG).
  const [hovered, setHovered] = useState<{ id: string; px: number; py: number } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    d3.select(node)
      .selectAll<SVGElement, unknown>(".bump-series")
      .style("opacity", function () {
        const id = (this as SVGElement).getAttribute("data-series");
        return hovered === null || id === hovered.id ? 1 : DIM_OPACITY;
      });
  }, [hovered, ref, columns, series, width, height]);

  const hoveredSeries = hovered ? series.find((s) => s.id === hovered.id) : undefined;
  const tooltipRows: TooltipRow[] = hoveredSeries
    ? hoveredSeries.ranks.flatMap((rank, i) =>
        rank === null ? [] : [{ label: columns[i], value: `#${rank}`, color: hoveredSeries.color, noSwatch: true, labelFirst: true }],
      )
    : [];

  /** The ribbon nearest the pointer — hit-testing by distance rather than
   * per-path events, so a thin ribbon under a crossing is still pickable and
   * the focus path below can share the logic. */
  function nearest(offsetX: number, offsetY: number): string | null {
    const px = offsetX - marginLeft;
    const py = offsetY - MARGIN.top;
    let best: { id: string; d: number } | null = null;
    const xs = columns.map((_, i) => x(i) as number);
    for (const s of series) {
      for (const run of runsOf(s.ranks)) {
        for (let k = 0; k < run.length; k++) {
          const [col, rank] = run[k];
          const candidates = [{ cx: xs[col], cy: y(rank) }];
          // Along the ribbon to its right neighbour, sampled at the midpoint.
          if (k + 1 < run.length) {
            const [nc, nr] = run[k + 1];
            candidates.push({ cx: (xs[col] + xs[nc]) / 2, cy: (y(rank) + y(nr)) / 2 });
          }
          for (const c of candidates) {
            const d = Math.hypot(px - c.cx, py - c.cy);
            if (!best || d < best.d) best = { id: s.id, d };
          }
        }
      }
    }
    return best && best.d <= 24 ? best.id : null;
  }

  const order = series.map((s) => s.id);

  return (
    <div style={{ position: "relative", width, height }}>
      <svg ref={ref} />
      <div
        className="absolute inset-0"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={(e) => {
          const { offsetX, offsetY } = e.nativeEvent;
          const id = nearest(offsetX, offsetY);
          setHovered(id === null ? null : { id, px: offsetX, py: offsetY });
        }}
        onPointerLeave={() => setHovered(null)}
        onFocus={() => setHovered((cur) => cur ?? (order.length ? { id: order[0], px: marginLeft, py: MARGIN.top } : null))}
        onBlur={() => setHovered(null)}
        onKeyDown={(e) => {
          if (order.length === 0) return;
          const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
          if (step === 0) {
            if (e.key === "Escape") setHovered(null);
            return;
          }
          e.preventDefault();
          const at = hovered ? order.indexOf(hovered.id) : -1;
          const next = order[(at + step + order.length) % order.length];
          const s = series.find((m) => m.id === next);
          const firstCol = s ? s.ranks.findIndex((r) => r !== null) : -1;
          if (!s || firstCol === -1) return;
          setHovered({ id: next, px: marginLeft + (x(firstCol) as number), py: MARGIN.top + y(s.ranks[firstCol] as number) });
        }}
      />
      {hovered && hoveredSeries ? (
        <ChartTooltip x={hovered.px} y={hovered.py} title={hoveredSeries.label} rows={tooltipRows} containerWidth={width} />
      ) : null}
    </div>
  );
}
