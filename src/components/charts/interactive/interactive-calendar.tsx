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
//
// Layout is Monday-first throughout (week columns *and* month-label
// alignment both key off d3.timeMonday), per user feedback on the first
// version — GitHub's own calendar (and ISO 8601) start the week on
// Monday, and the requested day-of-week labels ("m,t,w,t,f,s,s") only
// make sense read top-to-bottom against a Monday-first grid.

const CELL_GAP = 2;
// A single top strip per year houses both the year number (far left, in
// LEFT_LABEL_WIDTH's column) and the month abbreviations (spanning the
// grid) at the same y position — see the `g.append("text")` calls below.
const YEAR_LABEL_HEIGHT = 18;
const YEAR_GAP = 14;
// Single-letter day labels ("M"/"T"/"W"/...) need much less horizontal
// room than 3-letter abbreviations would, so most of this column's width
// is unused by them — it's sized instead for the year number, which is
// right-anchored against the grid's edge (see the `g.append("text")` call
// below) and needs enough room for 4 digits without bleeding into
// January's month label just to its right.
const LEFT_LABEL_WIDTH = 30;
// Monday-first — see the module comment above. Index 0 = Monday, matching
// the `dow` remap below ((getDay() + 6) % 7).
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
// GitHub's own contribution graph uses 53 week-columns as a safe upper
// bound for any year regardless of which weekday Jan 1 falls on (a year
// can span 53 distinct Monday-starting weeks; using a fixed column count
// keeps every year's grid the same width instead of jittering by one
// column year to year).
const WEEKS_PER_YEAR = 53;
// cellSize is purely a function of the *measured* container width (see
// below) — no separate pre-measurement "guess" constant. An earlier
// version had a HEIGHT_GUESS_CELL_SIZE baked into a caller-facing
// estimateCalendarHeight() that could disagree with the real computed
// cellSize once actually measured, and that mismatch — a shorter
// *guessed* height than the SVG the real cellSize went on to paint — was
// the direct cause of a reported desktop height overflow. The fix is
// structural, not a closer guess: this component doesn't export a height
// estimate at all, and callers size it with ResponsiveChart's auto-height
// mode (height prop omitted), which measures the container's own
// rendered height instead of predicting it up front. See
// sleep-calendar-chart.tsx.
const MIN_CELL_SIZE = 8;
const MAX_CELL_SIZE = 18;

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

type YearGroup = { year: number; days: Map<string, number> };
type CellDatum = { dateStr: string; value: number; week: number; dow: number };
type Hovered = { dateStr: string; value: number; clientPos: { x: number; y: number } };
type MonthTick = { label: string; week: number };

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
    // Most recent year first (top of the stack) — per user feedback; a
    // reader scanning down wants "now" first, not the oldest year on file.
    return [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, days]) => ({ year, days }));
  }, [points]);

  // Purely width-driven: floor(available / WEEKS_PER_YEAR) minus the
  // inter-cell gap, clamped to a legible-but-not-huge range. No disconnected
  // "guess" constant feeding this (see MIN/MAX_CELL_SIZE's comment above) —
  // this is the one and only place cellSize is computed, from the real
  // measured `width`.
  const cellSize = Math.min(
    MAX_CELL_SIZE,
    Math.max(MIN_CELL_SIZE, Math.floor((width - LEFT_LABEL_WIDTH) / WEEKS_PER_YEAR) - CELL_GAP),
  );
  const rowHeight = cellSize + CELL_GAP;
  const yearBlockHeight = 7 * rowHeight;
  const totalHeight = years.length * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP);

  // The day-of-week label column and the day grid are ONE visual unit —
  // center that whole unit in the available width, rather than centering
  // the grid alone and leaving the labels pinned to the container's edge
  // (which is what the previous version did, and what read as the labels
  // being "detached" from the grid: as the grid shifted to center itself,
  // the label column stayed put and a gap opened up between them). Both
  // the label column and the grid live inside the same translated `g`
  // below, so they now move together by construction.
  const gridWidth = WEEKS_PER_YEAR * rowHeight;
  const totalContentWidth = LEFT_LABEL_WIDTH + gridWidth;
  const outerOffset = Math.max(0, (width - totalContentWidth) / 2);
  const gridLeft = outerOffset + LEFT_LABEL_WIDTH;

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
        const yearEnd = new Date(yearGroup.year + 1, 0, 1);
        const g = svg
          .append("g")
          .attr(
            "transform",
            `translate(${gridLeft},${yi * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP) + YEAR_LABEL_HEIGHT})`,
          );

        // Year number and day-of-week labels both live inside this same
        // translated `g`, so they move together with the grid as one
        // connected unit no matter where `gridLeft` centers it. The year
        // number is right-anchored a fixed gap before the grid's local
        // origin (x=0, where January's month label starts) instead of
        // left-anchored at a fixed x — a left anchor let a 4-digit year
        // overflow rightward into January's label; right-anchoring
        // guarantees clearance regardless of how wide the year text is.
        g.append("text")
          .attr("x", -6)
          .attr("y", -6)
          .attr("text-anchor", "end")
          .attr("fill", "var(--foreground)")
          .style("font-size", "12px")
          .style("font-weight", 500)
          .text(String(yearGroup.year));

        // Month labels along the top of the strip, aligned to the same
        // Monday-keyed week columns the day cells use below. Declutters
        // by simply dropping a label that would land too close to the
        // previously-placed one (narrow container -> narrow week columns
        // -> adjacent month labels would otherwise overlap).
        const monthTicks: MonthTick[] = d3.timeMonths(yearStart, yearEnd).map((monthStart) => ({
          label: monthStart.toLocaleDateString(undefined, { month: "short" }),
          week: d3.timeMonday.count(yearStart, monthStart),
        }));
        const MIN_LABEL_GAP = 24;
        let lastLabelX = -Infinity;
        for (const tick of monthTicks) {
          const x = tick.week * rowHeight;
          if (x - lastLabelX < MIN_LABEL_GAP) continue;
          lastLabelX = x;
          g.append("text")
            .attr("x", x)
            .attr("y", -6)
            .attr("fill", "var(--muted-foreground)")
            .style("font-size", "10px")
            .text(tick.label);
        }

        g.selectAll(".daylabel")
          .data(DAY_LABELS)
          .join("text")
          .attr("class", "daylabel")
          .attr("x", -LEFT_LABEL_WIDTH + 2)
          .attr("y", (_, i) => i * rowHeight + cellSize - 1)
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", "9px")
          .text((d) => d);

        const cells: CellDatum[] = [...yearGroup.days.entries()].map(([dateStr, value]) => {
          const date = parseDate(dateStr);
          const week = d3.timeMonday.count(yearStart, date);
          // Monday-first row order: getDay() is Sunday=0..Saturday=6, so
          // shift by 6 mod 7 to land Monday=0..Sunday=6, matching
          // DAY_LABELS's top-to-bottom "M,T,W,T,F,S,S" order.
          const dow = (date.getDay() + 6) % 7;
          return { dateStr, value, week, dow };
        });

        // Two rects per cell, not one: the small visible one (cellSize can
        // be as little as 8px) and a separate, larger invisible hit
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
    [years, width, cellSize, rowHeight, yearBlockHeight, totalHeight, gridLeft, colorScale],
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

  // Where the hovered cell's value falls on the low->high legend, as a
  // 0-1 fraction — drives the hover indicator line below. Clamped in case
  // of floating-point edges right at the domain endpoints.
  const legendT =
    hovered !== null
      ? Math.min(1, Math.max(0, (hovered.value - domain[0]) / ((domain[1] - domain[0]) || 1)))
      : null;

  return (
    // overflow-x-auto is a safety net, not the primary width fix: at the
    // MIN_CELL_SIZE floor on a very narrow viewport, WEEKS_PER_YEAR fixed
    // columns can still add up to more px than the container actually
    // has. Rather than shrinking cells past legibility to force a fit,
    // this lets that rare case scroll horizontally (same tradeoff
    // GitHub's own contribution graph makes on mobile) instead of
    // visually breaking out of the container.
    <div style={{ width }} className="overflow-x-auto">
      <div ref={setContainerEl} style={{ position: "relative", width }} role="img" aria-label={ariaLabel}>
        <svg ref={ref} />
        {hovered && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={formatDate(hovered.dateStr, "weekdayYear")}
            rows={[{ label: valueLabel, value: formatValue(hovered.value), color: hoveredColor ?? "" }]}
            containerWidth={width}
          />
        ) : null}
      </div>
      {/* The legend/scale swatch — low -> high, so the color ramp's
          meaning doesn't rely on the reader guessing from the cells alone
          (marks-and-anatomy.md: never make color the only channel).
          `position: fixed` pinned to the bottom of the *viewport*, not
          `sticky` within the calendar's own block — per feedback, the
          legend should stay visible on screen at all times the page is
          open, not just while the grid itself is in frame. `fixed` also
          sidesteps the risk `sticky` had here: ChartCard (ui/card.tsx)
          sets `overflow-hidden` on its wrapper, which in some browsers
          can break a `sticky` descendant's ability to track page scroll,
          but has no effect on `fixed` (it escapes every ancestor's
          overflow/containing-block, short of one with its own
          transform/filter — none of this app's chart-page ancestors set
          those).

          `position: fixed` takes an element out of flow entirely, so it
          no longer inherits the calendar's own width/position for free
          the way a normal or sticky sibling would — its `left`/`width`
          are computed explicitly from `containerRect` (the same
          measured-container rect the tooltip above already uses) offset
          by `gridLeft`/sized to `gridWidth`, so it lines up with the
          *grid* itself (where the cells are), not the wider outer box
          that also includes the day-label column and any centering
          margin. Gated on `containerRect` so it doesn't flash at (0,0)
          for one frame before the first measurement lands. This only
          needs to be recomputed when the calendar's own box actually
          moves or resizes (ResponsiveChart's ResizeObserver already
          forces a re-render — and a fresh getBoundingClientRect() read —
          whenever that happens); a vertical-only scroll doesn't change a
          block's horizontal position, so this doesn't need to track
          scroll events itself. The hover indicator (a small tick riding
          the gradient) answers "where does this cell's value sit on the
          scale" directly, rather than making the reader eyeball a color
          match against the swatch. */}
      {containerRect ? (
        <div
          className="fixed bottom-0 z-10 flex items-center gap-3 border-t border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur"
          style={{ left: containerRect.left + gridLeft, width: gridWidth }}
        >
          <span className="shrink-0 tabular-nums">{formatValue(domain[0])}</span>
          <span className="relative h-2 min-w-0 flex-1">
            <span
              aria-hidden
              className="block h-2 w-full rounded-full"
              style={{ background: `linear-gradient(to right, ${gradientStops.join(", ")})` }}
            />
            {legendT !== null ? (
              <span
                aria-hidden
                className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm"
                style={{ left: `${legendT * 100}%` }}
              />
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums">{formatValue(domain[1])}</span>
        </div>
      ) : null}
    </div>
  );
}
