"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { MARK_SPECS, attachMarkHover } from "./marks";
import { ChartTooltip } from "./tooltip";
import { sequentialScale, type ColorMode } from "@/lib/viz/color";
import { formatDate } from "@/lib/viz/format";
import { parseDate } from "@/lib/date";

// InteractiveCalendar (#21) — the shared calendar-heatmap primitive,
// generalizing SleepCalendarChart (already a strong prototype: multi-year
// GitHub-style strips, cell size that shrinks to fit) into a reusable
// component for any day-keyed metric, not just sleep. Legacy's
// Calendar/MultiCalendar (functions/views/vis/vis_functions.js) returned
// an array of raw DOM nodes the caller had to re-append by hand —
// deliberately not preserved; this renders itself like any other React
// component.

const CELL_GAP = 2;
const YEAR_LABEL_HEIGHT = 18;
const YEAR_GAP = 14;
const LEFT_LABEL_WIDTH = 30;
const DAY_LABELS = ["Sun", "", "Tue", "", "Thu", "", "Sat"];
// A fixed row height purely for the legend swatch below the grid — not a
// layout constant the SVG rendering itself depends on.
const LEGEND_ROW_HEIGHT = 24;
// Used only for the pre-measurement height guess a caller's ResponsiveChart
// needs before InteractiveCalendar has actually rendered and picked its
// real cell size from the container's *measured* width (see `cellSize`'s
// computation below, which depends on `width` — not known until after
// first render) — not a rendering constant itself.
const HEIGHT_GUESS_CELL_SIZE = 12;

export type InteractiveCalendarPoint = {
  date: string; // "YYYY-MM-DD"
  value: number;
};

export type InteractiveCalendarProps = {
  points: InteractiveCalendarPoint[];
  width: number;
  /** Formats a cell's value for the tooltip row and the legend's low/high
   * endpoints — e.g. `(minutes) => `${(minutes / 60).toFixed(1)}h``. */
  formatValue: (value: number) => string;
  /** Row label in the tooltip describing what the value is — e.g.
   * "sleep". Defaults to "value". */
  valueLabel?: string;
  /** Sequential color mode — defaults to "dark" since this app currently
   * renders dark-mode-only (layout.tsx hardcodes the `dark` class on
   * `<html>`; there's no light/dark toggle yet). Revisit this default if
   * that ever changes — see viz/color.ts's own `ColorMode`. */
  colorMode?: ColorMode;
  ariaLabel?: string;
};

/** Pre-measurement height estimate for a caller's `ResponsiveChart` — the
 * real height depends on the cell size InteractiveCalendar picks from its
 * *measured* width, which isn't known until after the first render, so a
 * caller needs a reasonable guess to give ResponsiveChart a starting
 * height (ResponsiveChart's fixed-height mode, not its viewport-filling
 * mode — a calendar's height is content-derived from year count, not
 * something that should stretch to fill the screen). Exported so that
 * guess always matches this file's own layout constants instead of a
 * second, hand-copied formula drifting out of sync with them in whatever
 * wraps this component. */
export function estimateCalendarHeight(yearCount: number): number {
  if (yearCount === 0) return 200;
  return (
    yearCount * (7 * (HEIGHT_GUESS_CELL_SIZE + CELL_GAP) + YEAR_LABEL_HEIGHT + YEAR_GAP) + LEGEND_ROW_HEIGHT
  );
}

type YearGroup = { year: number; days: Map<string, number> };
type CellDatum = { dateStr: string; value: number; week: number; dow: number };
type Hovered = { dateStr: string; value: number; clientPos: { x: number; y: number } };

export function InteractiveCalendar({
  points,
  width,
  formatValue,
  valueLabel = "value",
  colorMode = "dark",
  ariaLabel = "Calendar heatmap. Hover a day to see its value.",
}: InteractiveCalendarProps) {
  const years = useMemo<YearGroup[]>(() => {
    const byYear = new Map<number, Map<string, number>>();
    for (const p of points) {
      const year = parseInt(p.date.slice(0, 4), 10);
      if (!byYear.has(year)) byYear.set(year, new Map());
      byYear.get(year)!.set(p.date, p.value);
    }
    return [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, days]) => ({ year, days }));
  }, [points]);

  const cellSize = Math.min(14, Math.max(6, Math.floor((width - LEFT_LABEL_WIDTH) / 54) - CELL_GAP));
  const rowHeight = cellSize + CELL_GAP;
  const yearBlockHeight = 7 * rowHeight;
  const totalHeight = years.length * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP);

  const domain = useMemo<[number, number]>(() => {
    const [lo, hi] = d3.extent(points, (p) => p.value);
    if (lo === undefined || hi === undefined) return [0, 1];
    return lo === hi ? [lo - 1, lo + 1] : [lo, hi];
  }, [points]);

  const colorScale = useMemo(() => sequentialScale(domain, colorMode), [domain, colorMode]);

  const [hovered, setHovered] = useState<Hovered | null>(null);
  // State-backed callback ref, not a plain useRef — see interactive-hist.tsx's
  // identical comment: getBoundingClientRect() below runs during render (to
  // position the tooltip from a hover's *client* coordinates), and reading
  // a plain ref's `.current` during render is what this project's lint
  // rule (correctly) warns against.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", totalHeight);

      years.forEach((yearGroup, yi) => {
        const yearStart = new Date(yearGroup.year, 0, 1);
        const g = svg
          .append("g")
          .attr(
            "transform",
            `translate(${LEFT_LABEL_WIDTH},${yi * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP) + YEAR_LABEL_HEIGHT})`,
          );

        g.append("text")
          .attr("x", -LEFT_LABEL_WIDTH + 2)
          .attr("y", -6)
          .attr("fill", "var(--foreground)")
          .style("font-size", "12px")
          .style("font-weight", 500)
          .text(String(yearGroup.year));

        g.selectAll(".daylabel")
          .data(DAY_LABELS)
          .join("text")
          .attr("class", "daylabel")
          .attr("x", -LEFT_LABEL_WIDTH + 2)
          .attr("y", (_, i) => i * rowHeight + cellSize - 1)
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", "8px")
          .text((d) => d);

        const cells: CellDatum[] = [...yearGroup.days.entries()].map(([dateStr, value]) => {
          const date = parseDate(dateStr);
          const week = d3.timeSunday.count(yearStart, date);
          const dow = date.getDay();
          return { dateStr, value, week, dow };
        });

        // Two rects per cell, not one: the small visible one (cellSize can
        // be as little as 6px) and a separate, larger invisible hit
        // target — exactly the case marks.ts's own MARK_SPECS.hover doc
        // comment calls out by name ("calendar cells, scatter points")
        // for sizing the hit area yourself rather than the painted mark.
        g.selectAll(".cell")
          .data(cells)
          .join("rect")
          .attr("class", "cell")
          .attr("x", (d) => d.week * rowHeight)
          .attr("y", (d) => d.dow * rowHeight)
          .attr("width", cellSize)
          .attr("height", cellSize)
          .attr("rx", 2)
          .attr("fill", (d) => colorScale(d.value));

        const hitSize = Math.max(cellSize, MARK_SPECS.hover.minHitTarget);
        const hitTargets = g
          .selectAll(".hit")
          .data(cells)
          .join("rect")
          .attr("class", "hit")
          .attr("x", (d) => d.week * rowHeight + cellSize / 2 - hitSize / 2)
          .attr("y", (d) => d.dow * rowHeight + cellSize / 2 - hitSize / 2)
          .attr("width", hitSize)
          .attr("height", hitSize)
          .attr("fill", "transparent");

        attachMarkHover<CellDatum>(hitTargets, {
          onHover: (d, clientPos) => setHovered({ dateStr: d.dateStr, value: d.value, clientPos }),
          onLeave: () => setHovered(null),
        });
      });
    },
    [years, width, cellSize, rowHeight, yearBlockHeight, totalHeight, colorScale],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredColor = hovered ? colorScale(hovered.value) : undefined;

  // Ten sampled stops (not just the two endpoints) — sequentialScale's
  // interpolator (interpolateHcl) isn't linear in sRGB, so a plain
  // 2-stop CSS gradient would visibly diverge from what the cells
  // themselves actually render partway through the ramp.
  const gradientStops = useMemo(() => {
    const interpolate = colorScale.interpolator();
    return d3.range(0, 1.0001, 0.1).map((t) => interpolate(t));
  }, [colorScale]);

  return (
    <div style={{ width }}>
      <div ref={setContainerEl} style={{ position: "relative", width }} role="img" aria-label={ariaLabel}>
        <svg ref={ref} />
        {hovered && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={formatDate(hovered.dateStr, "weekday")}
            rows={[{ label: valueLabel, value: formatValue(hovered.value), color: hoveredColor ?? "" }]}
            containerWidth={width}
          />
        ) : null}
      </div>
      {/* The legend/scale swatch — low -> high, so the color ramp's
          meaning doesn't rely on the reader guessing from the cells alone
          (marks-and-anatomy.md: never make color the only channel). */}
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        style={{ height: LEGEND_ROW_HEIGHT, marginLeft: LEFT_LABEL_WIDTH }}
      >
        <span className="tabular-nums">{formatValue(domain[0])}</span>
        <span
          aria-hidden
          className="h-2 w-20 rounded-full"
          style={{ background: `linear-gradient(to right, ${gradientStops.join(", ")})` }}
        />
        <span className="tabular-nums">{formatValue(domain[1])}</span>
      </div>
    </div>
  );
}
