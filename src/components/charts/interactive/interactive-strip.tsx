"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { summarize, type GroupSummary } from "@/lib/viz/stats";
import { styleAxis } from "./axis";
import { MARK_SPECS } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import type { ReferenceLine } from "./reference-lines";

// InteractiveStrip (#444) — "how does this value differ between groups":
// one row per group, each day a faint dot, and the group's mean drawn over
// them with a 95% confidence interval and its sample size.
//
// Built for Work vs. Happiness, and shaped for the other "average X by Y"
// questions on the chart backlog (productivity by location, sleep by day
// type). A bar of means was the obvious alternative and was rejected: a bar
// says nothing about how many days stand behind it, and these groups range
// from a handful of days to over a thousand. The interval and the `n`
// label are the point of the chart, not decoration — a row with a wide
// interval is telling the reader not to trust its mean yet.
//
// Horizontal rows rather than vertical columns so group labels ("Home +
// Office", "Under 40%") read without rotation, the same reason
// InteractiveRanked is a table.

export type InteractiveStripGroup = {
  id: string;
  label: string;
  values: { date: string; value: number }[];
};

export type InteractiveStripProps = {
  groups: InteractiveStripGroup[];
  width: number;
  height: number;
  /** One colour for every row. Rows are usually *ordered* bins (hours
   * bands), where giving each its own categorical hue would imply they're
   * unrelated kinds of thing. */
  color: string;
  /** Draw every individual value as a faint dot behind the mean. Off, the
   * x axis fits the intervals instead of the raw values, which zooms in on
   * the differences between means — useful when the spread of single days
   * is much wider than the differences between groups (happiness: days
   * range 20–100, group means sit within a few points of each other). */
  showPoints?: boolean;
  /** Clamp for the auto-fit x domain — a 0–100 score shouldn't get an axis
   * running to 104 because of padding. */
  valueBounds?: [number, number];
  valueFormat: (value: number) => string;
  /** Vertical reference lines at fixed x values — e.g. the average across
   * every day, so each row reads as above or below it. Same shape as the
   * line primitives' horizontal ones. */
  referenceLines?: readonly ReferenceLine[];
  /** Tooltip label for the `n` row — "Days", "Nights". */
  countLabel?: string;
  ariaLabel: string;
};

const MARGIN = { top: 20, right: 64, bottom: 28 };
const LABEL_FONT_PX = 12;
const MAX_ROW_HEIGHT = 72;
const POINT_RADIUS = 3;
const MEAN_RADIUS = 6;
/** Groups smaller than this still draw their interval, but don't widen the
 * axis to fit it. At n = 2 the t multiplier is 12.7, so one two-day row can
 * produce an interval spanning the whole scale and squash every other
 * row's comparison into a sliver. Its whisker is clipped instead, with no
 * end cap, so it reads as "runs off the chart", not as a real bound. */
const MIN_N_FOR_DOMAIN = 3;

/** Deterministic vertical jitter in [-1, 1] from a day's date, so the dots
 * don't reshuffle every time the SVG is rebuilt (a resize, a picker
 * change) — a random jitter would make the same day hop around. FNV-1a. */
function jitter(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

type Row = InteractiveStripGroup & { summary: GroupSummary };

export function InteractiveStrip({
  groups,
  width,
  height,
  color,
  showPoints = true,
  valueBounds,
  valueFormat,
  referenceLines,
  countLabel = "Days",
  ariaLabel,
}: InteractiveStripProps) {
  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap((g) => {
        const summary = summarize(g.values.map((v) => v.value));
        return summary ? [{ ...g, summary }] : [];
      }),
    [groups],
  );

  // Sized to the longest label (a rough per-character width — no text
  // measurement inside a render pass, same trade-off InteractiveScroller's
  // `estimateTextWidth` makes), capped so a long label can't eat the plot.
  const marginLeft = useMemo(() => {
    const longest = d3.max(rows, (r) => r.label.length) ?? 4;
    return Math.min(180, Math.max(56, longest * LABEL_FONT_PX * 0.6 + 16));
  }, [rows]);

  const innerWidth = Math.max(0, width - marginLeft - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  // Content-sized rows, centred — a comparison of three groups shouldn't
  // stretch each row to a third of a tall card. Same call
  // InteractiveTimeline makes for its lanes.
  const rowHeight = rows.length ? Math.min(MAX_ROW_HEIGHT, innerHeight / rows.length) : 0;
  const rowsTop = MARGIN.top + (innerHeight - rowHeight * rows.length) / 2;

  const x = useMemo(() => {
    const extent: number[] = [];
    for (const r of rows) {
      extent.push(r.summary.mean);
      if (r.summary.n >= MIN_N_FOR_DOMAIN) extent.push(r.summary.ciLow, r.summary.ciHigh);
      if (showPoints) for (const v of r.values) extent.push(v.value);
    }
    for (const l of referenceLines ?? []) extent.push(l.value);
    let [lo, hi] = (d3.extent(extent.length ? extent : [0, 1]) as [number, number]);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    if (valueBounds) {
      lo = Math.max(valueBounds[0], lo);
      hi = Math.min(valueBounds[1], hi);
    }
    return d3.scaleLinear().domain([lo, hi]).nice().range([0, innerWidth]);
  }, [rows, showPoints, referenceLines, valueBounds, innerWidth]);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", height);
      const g = svg.append("g").attr("transform", `translate(${marginLeft},0)`);

      // Vertical gridlines — the reader compares means across rows by
      // position alone, and a faint grid is what makes that comparison
      // across a tall gap reliable.
      g.append("g")
        .attr("transform", `translate(0,${MARGIN.top})`)
        .attr("aria-hidden", "true")
        .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(innerWidth / 80))).tickSize(innerHeight).tickFormat(() => ""))
        .call((sel) => sel.select(".domain").remove())
        .call((sel) => sel.selectAll("line").attr("stroke", "var(--border)").attr("stroke-opacity", 0.6));

      const axisG = g.append("g").attr("transform", `translate(0,${MARGIN.top + innerHeight})`);
      styleAxis(
        axisG,
        d3
          .axisBottom(x)
          .ticks(Math.max(2, Math.floor(innerWidth / 80)))
          .tickFormat((v) => valueFormat(Number(v))),
      );

      for (const line of referenceLines ?? []) {
        const px = x(line.value);
        if (px < 0 || px > innerWidth) continue;
        const lineColor = line.color ?? "var(--muted-foreground)";
        g.append("line")
          .attr("x1", px)
          .attr("x2", px)
          .attr("y1", MARGIN.top)
          .attr("y2", MARGIN.top + innerHeight)
          .attr("stroke", lineColor)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "2,4");
        g.append("text")
          .attr("x", px)
          .attr("y", MARGIN.top - 6)
          .attr("text-anchor", "middle")
          .attr("fill", lineColor)
          .style("font-size", MARK_SPECS.axis.tickFontSize)
          .text(line.label);
      }

      rows.forEach((row, i) => {
        const cy = rowsTop + rowHeight * (i + 0.5);

        svg
          .append("text")
          .attr("x", marginLeft - 12)
          .attr("y", cy)
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("fill", "var(--foreground)")
          .style("font-size", `${LABEL_FONT_PX}px`)
          .text(row.label);

        if (showPoints) {
          const spread = Math.max(0, rowHeight * 0.32 - POINT_RADIUS);
          g.selectAll(null)
            .data(row.values)
            .join("circle")
            .attr("cx", (d) => x(d.value))
            .attr("cy", (d) => cy + jitter(d.date) * spread)
            .attr("r", POINT_RADIUS)
            .attr("fill", color)
            .attr("fill-opacity", 0.25);
        }

        const { mean, ciLow, ciHigh, n } = row.summary;
        const x0 = Math.max(0, x(ciLow));
        const x1 = Math.min(innerWidth, x(ciHigh));
        const clippedLow = x(ciLow) < 0;
        const clippedHigh = x(ciHigh) > innerWidth;
        const cap = 5;
        g.append("line")
          .attr("x1", x0)
          .attr("x2", x1)
          .attr("y1", cy)
          .attr("y2", cy)
          .attr("stroke", "var(--foreground)")
          .attr("stroke-width", MARK_SPECS.line.strokeWidth);
        for (const cx of [...(clippedLow ? [] : [x0]), ...(clippedHigh ? [] : [x1])]) {
          g.append("line")
            .attr("x1", cx)
            .attr("x2", cx)
            .attr("y1", cy - cap)
            .attr("y2", cy + cap)
            .attr("stroke", "var(--foreground)")
            .attr("stroke-width", MARK_SPECS.line.strokeWidth);
        }
        g.append("circle")
          .attr("cx", x(mean))
          .attr("cy", cy)
          .attr("r", MEAN_RADIUS)
          .attr("fill", color)
          .attr("stroke", "var(--card)")
          .attr("stroke-width", MARK_SPECS.marker.ringWidth);

        // Sample size beside every row, not only in the tooltip: it's the
        // number that says how much to trust the dot, so it has to be
        // visible while comparing rows, not one hover at a time.
        g.append("text")
          .attr("x", innerWidth + 10)
          .attr("y", cy)
          .attr("dy", "0.35em")
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", MARK_SPECS.axis.tickFontSize)
          .text(`n = ${n}`);
      });
    },
    [rows, width, height, marginLeft, innerWidth, innerHeight, rowHeight, rowsTop, x, color, showPoints, referenceLines, valueFormat],
  );

  // Hover/keyboard state is React state driving the separately-rendered
  // highlight band and tooltip, never a `useD3` dependency (AGENTS.md's
  // rule for per-pointer-move state).
  const [hovered, setHovered] = useState<number | null>(null);
  const rowAt = (offsetY: number) => {
    if (!rowHeight) return null;
    const i = Math.floor((offsetY - (rowsTop - MARGIN.top)) / rowHeight);
    return i >= 0 && i < rows.length ? i : null;
  };

  const hoveredRow = hovered === null ? null : rows[hovered];
  const tooltipRows: TooltipRow[] = hoveredRow
    ? [
        { label: "Average", value: valueFormat(hoveredRow.summary.mean), color, labelFirst: true },
        {
          label: "95% interval",
          value:
            hoveredRow.summary.n > 1
              ? `${valueFormat(hoveredRow.summary.ciLow)} – ${valueFormat(hoveredRow.summary.ciHigh)}`
              : "n/a (one day)",
          color: "var(--foreground)",
          noSwatch: true,
          labelFirst: true,
        },
        { label: countLabel, value: String(hoveredRow.summary.n), color, noSwatch: true, labelFirst: true },
      ]
    : [];

  return (
    <div style={{ position: "relative", width, height }}>
      <svg ref={ref} />
      <div
        className="absolute"
        style={{ left: marginLeft, top: MARGIN.top, width: innerWidth, height: innerHeight }}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={(e) => setHovered(rowAt(e.nativeEvent.offsetY))}
        onPointerLeave={() => setHovered(null)}
        onFocus={() => setHovered((cur) => cur ?? (rows.length ? 0 : null))}
        onBlur={() => setHovered(null)}
        onKeyDown={(e) => {
          if (rows.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHovered((cur) => Math.min(rows.length - 1, (cur ?? -1) + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHovered((cur) => Math.max(0, (cur ?? rows.length) - 1));
          } else if (e.key === "Escape") {
            setHovered(null);
          }
        }}
      >
        {hovered !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 left-0 rounded-sm bg-foreground/5"
            style={{ top: rowsTop - MARGIN.top + rowHeight * hovered, height: rowHeight }}
          />
        ) : null}
      </div>
      {hoveredRow && hovered !== null ? (
        <ChartTooltip
          x={marginLeft + x(hoveredRow.summary.mean)}
          y={rowsTop + rowHeight * (hovered + 0.5)}
          title={hoveredRow.label}
          rows={tooltipRows}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
