"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { styleAxis } from "./axis";
import { attachMarkHover, MARK_SPECS, roundedBarPath } from "./marks";
import { ChartTooltip } from "./tooltip";
import { categoricalColor } from "@/lib/viz/color";
import { formatDate } from "@/lib/viz/format";
import { daysBetween, todayDateString } from "@/lib/date";
import { layoutTimeline, type LaidOutInterval, type TimelineInterval } from "@/lib/viz/timeline";

// InteractiveTimeline (#119) — the Gantt-style interval primitive, and the
// third of the three new primitives #109 exists for. A generic successor to
// legacy's `TimeLine()` (functions/views/vis/vis_functions.js:2969), which
// drew occupation/residence/location histories as fixed-size, mouse-less
// SVG.
//
// What legacy did that's kept: horizontal bars, y = an ordinal lane, x = a
// time interval per item, and automatic sub-lane stacking when items in one
// lane overlap. That last part is the real work, and it lives in
// src/lib/viz/timeline.ts as a pure function so the stacking can be tested
// without rendering anything.
//
// What legacy did that's deliberately *not* kept:
//
//  - **Labels baked into every bar.** Legacy word-wrapped a label inside
//    each bar and shrank the font to fit, with a floor — which means on a
//    short interval the text either overflowed or became unreadable. Here
//    the label is drawn only when the bar is genuinely wide enough to hold
//    it, and the shared ChartTooltip carries the full detail on hover or
//    focus. A tooltip that appears on demand beats permanent 6px text.
//  - **A hardcoded colour per call site.** Colour now comes from the
//    shared system, keyed by lane index — see `color` below.
//  - **No zoom.** A decades-long timeline was simply cramped. This one
//    zooms and pans on x (the only axis where zooming means anything: the
//    y axis is ordinal lanes, and stretching those tells you nothing).
//
// Sizing: rows share the height the caller offers, within a readable band,
// and the chart then draws only as tall as it actually needs, centred in
// that space. A timeline has no natural way to fill arbitrary vertical
// space — three lanes are three lanes — so stretching rows to fill a tall
// card would just produce three slabs. Past the row-height floor the SVG
// grows instead of compressing bars into invisibility, and the wrapper
// scrolls within the space it was given.

const DEFAULT_MARGIN = { top: 8, right: 16, bottom: 28, left: 96 };

/** Row geometry, px. A row is one sub-lane: its bar plus the air around it. */
const ROW = {
  /** Below this a bar stops being readable, so the chart gets taller and
   * scrolls rather than compressing further. */
  minHeight: 22,
  /** Above this, rows stop growing and the extra space becomes padding —
   * a three-lane timeline in a tall container shouldn't render three
   * 200px slabs. */
  maxHeight: 44,
  /** Share of a row the bar itself occupies; the rest is the gap that
   * separates it from the row above and below (MARK_SPECS.bar.surfaceGap's
   * reasoning, applied vertically). */
  barRatio: 0.62,
};

/** Bars narrower than this get no inline label — see the module comment on
 * why legacy's shrink-to-fit text was worth dropping. */
const MIN_LABEL_WIDTH = 44;

/** Left-edge accent marking an interval with no recorded end. Drawn as a
 * bar that runs to the right edge of its data would be a lie — it would
 * read as "ended today". */
const ONGOING_STRIPE_WIDTH = 3;

export type InteractiveTimelineProps = {
  items: TimelineInterval[];
  width: number;
  height: number;
  /** What an interval with `end: null` runs to. Defaults to today; a
   * caller pins it for a period-scoped view (or a test). */
  openEnd?: string;
  /** Bar fill — a single colour, or a function keyed off the item (same
   * prop shape InteractiveRanked and InteractiveNetwork use). Defaults to
   * one categorical slot per lane, in lane order.
   *
   * Per *lane*, not per item, which is a real departure from legacy's
   * per-item colour: `categoricalColor` has five distinct slots before it
   * flattens to grey (see viz/color.ts), so colouring 30 residences
   * individually would hand most of them the same muted grey and imply a
   * grouping that isn't there. A lane is the actual series here. */
  color?: string | ((item: LaidOutInterval, laneIndex: number) => string);
  /** The visible x window, or `null` for the whole extent.
   *
   * Optional and *controlled*: pass it together with `onDomainChange` and
   * the caller owns the window, so an external control (a range slider,
   * a "since 2016" default) and the chart's own wheel-zoom stay one piece
   * of state instead of two that drift apart. Omit both and the chart
   * keeps the window internally, which is all a caller with no external
   * controls needs. */
  domain?: [Date, Date] | null;
  onDomainChange?: (domain: [Date, Date] | null) => void;
  /** Tooltip row label for the interval's span. Defaults to "span". */
  valueLabel?: string;
  margin?: Partial<typeof DEFAULT_MARGIN>;
  ariaLabel?: string;
};

type Hovered = { item: LaidOutInterval; color: string; clientPos: { x: number; y: number } };

/**
 * Black or white for a label sitting *on* `fill`, whichever the reader can
 * actually see.
 *
 * A fixed label colour doesn't work here. The first version used
 * `var(--card)`, which is white in light mode (fine on a saturated bar) but
 * near-black in dark mode — so every label went dark-on-dark the moment the
 * chart was viewed in the theme most of this app is used in. And even a
 * fixed white would fail on the pale colours a user can pick for an entry
 * in the profile admin UI.
 *
 * `fill` is read back off the painted element with `getComputedStyle`
 * rather than taken from the colour we set, because that colour is often a
 * `var(--chart-N)` reference that only the browser can resolve. Where
 * there's no resolved colour to measure (jsdom computes no styles), white
 * is the safer guess: the default palette is mid-to-dark.
 *
 * The 0.179 threshold is the real WCAG crossover — the luminance at which
 * contrast against black overtakes contrast against white — not a
 * hand-tuned number.
 */
function contrastingTextColor(fill: string): string {
  const rgb = d3.color(fill)?.rgb();
  if (!rgb || Number.isNaN(rgb.r)) return "#ffffff";
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.179 ? "#111111" : "#ffffff";
}

/** "3 yrs 2 mos", "8 mos", "24 days" — a span, not a date. Deliberately
 * local rather than added to viz/format.ts: `formatDuration` there means
 * hours-within-a-day, and overloading it with calendar-length spans would
 * make both harder to read. */
function formatSpan(startDate: string, endDate: string): string {
  const days = Math.max(0, daysBetween(startDate, endDate));
  if (days < 45) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} ${months === 1 ? "mo" : "mos"}`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder === 0 ? `${years} yrs` : `${years} yrs ${remainder} ${remainder === 1 ? "mo" : "mos"}`;
}

export function InteractiveTimeline({
  items,
  width,
  height,
  openEnd,
  color,
  domain: controlledDomain,
  onDomainChange,
  valueLabel = "span",
  margin,
  ariaLabel = "Timeline. Each bar is one interval, grouped into lanes down the left. Scroll or pinch to zoom the time axis, drag to pan. Hover or focus a bar for its dates.",
}: InteractiveTimelineProps) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // A state-backed callback ref, not a plain useRef — see interactive-
  // hist's own comment on why this needs to be state, not a ref read
  // during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  // Visible x extent, or null for "everything". Held as state rather than
  // read off the zoom transform inside the render function so the axis and
  // the bars are always drawn from the same domain.
  //
  // The internal copy is only in play when the caller isn't controlling
  // the window — the standard uncontrolled/controlled pair. `isControlled`
  // keys off `onDomainChange` rather than `domain`, since a controlled
  // caller's domain is legitimately `null` whenever the full extent is
  // showing, and that mustn't read as "uncontrolled".
  const [internalDomain, setInternalDomain] = useState<[Date, Date] | null>(null);
  const isControlled = onDomainChange !== undefined;
  const visibleDomain = isControlled ? controlledDomain ?? null : internalDomain;
  const setVisibleDomain = useCallback(
    (next: [Date, Date] | null) => {
      if (onDomainChange) onDomainChange(next);
      else setInternalDomain(next);
    },
    [onDomainChange],
  );

  // Resolved once, here, rather than letting `layoutTimeline` apply its own
  // "default to today" internally while the tooltip separately falls back
  // to something else. Two independent defaults for the same idea is
  // exactly how an ongoing entry's tooltip came to report "0 days".
  const resolvedOpenEnd = openEnd ?? todayDateString();
  const layout = useMemo(
    () => layoutTimeline(items, { openEnd: resolvedOpenEnd }),
    [items, resolvedOpenEnd],
  );

  // The left margin holds the lane labels, so it has to be sized by them.
  // A fixed width was fine when lanes were "Occupation"/"Residence", and
  // broke the moment a consumer laned by something from the data — job and
  // company names ran off the left edge and were clipped by the SVG.
  //
  // Estimated from character count rather than measured: the real
  // measurement only exists once the text is in the DOM, which is after
  // every layout number here has already been used. The estimate is
  // deliberately generous, the labels are truncated to whatever it yields
  // (see the lane-label block below), and the cap keeps a pathological
  // lane name from eating the plot.
  const longestLane = layout.lanes.reduce((max, lane) => Math.max(max, lane.lane.length), 0);
  const laneLabelWidth = Math.min(longestLane * 6.4 + 20, width * 0.3);
  const requestedMargin = { ...DEFAULT_MARGIN, ...margin };
  const MARGIN = { ...requestedMargin, left: Math.max(requestedMargin.left, laneLabelWidth) };

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  // Rows share the height the caller gave, within the readable band; past
  // the floor the SVG grows and the wrapper scrolls. See the module comment.
  const availableHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const rowHeight = layout.totalRows
    ? Math.min(ROW.maxHeight, Math.max(ROW.minHeight, availableHeight / layout.totalRows))
    : ROW.minHeight;
  const innerHeight = layout.totalRows * rowHeight;
  // The SVG is exactly as tall as its content; the wrapper keeps the full
  // height it was given and centres that content inside it. A forty-row
  // timeline scrolls within that space rather than blowing the page layout
  // open; a three-lane one sits in the middle of its card instead of
  // clinging to the top with a void underneath.
  const svgHeight = innerHeight + MARGIN.top + MARGIN.bottom;

  const laneIndexByName = useMemo(
    () => new Map(layout.lanes.map((lane, i) => [lane.lane, i])),
    [layout],
  );

  const colorFor = useCallback(
    (item: LaidOutInterval) => {
      const laneIndex = laneIndexByName.get(item.lane) ?? 0;
      if (typeof color === "string") return color;
      if (color) return color(item, laneIndex);
      return categoricalColor(laneIndex);
    },
    [color, laneIndexByName],
  );

  const fullDomain = layout.domain;
  const effectiveDomain = visibleDomain ?? fullDomain;

  // Reset the view whenever the data itself changes — a zoom window from
  // the previous dataset is meaningless against a new one, and keeping it
  // would show an apparently-empty chart.
  //
  // Adjusted during render against the previously-seen value, which is
  // what React recommends for "reset state when a prop changes", rather
  // than in an effect: an effect would paint the new data through the old
  // window for a frame and then correct itself, and
  // react-hooks/set-state-in-effect rightly flags that.
  //
  // Only when the chart owns the window: a controlled caller decides for
  // itself whether a data change should reset the view, and calling its
  // onDomainChange from inside a render would be a side effect during
  // render, not just a state adjustment.
  const [itemsSeen, setItemsSeen] = useState(items);
  if (itemsSeen !== items) {
    setItemsSeen(items);
    if (!isControlled) setInternalDomain(null);
  }

  const zoomRef = useRef<{
    behavior: d3.ZoomBehavior<SVGSVGElement, unknown>;
    selection: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  } | null>(null);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (!fullDomain || !effectiveDomain || innerWidth <= 0) return;

      svg.attr("width", width).attr("height", svgHeight);
      const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      const x = d3.scaleTime().domain(effectiveDomain).range([0, innerWidth]);

      // Lane bands and their labels. Drawn first so everything else paints
      // over them. A separating rule between lanes, not a box around each:
      // the lanes are contiguous, and one hairline reads as a boundary
      // where two borders read as a table.
      const laneG = g.append("g").attr("aria-hidden", "true");
      for (const [index, lane] of layout.lanes.entries()) {
        const top = lane.firstRow * rowHeight;
        const laneHeight = lane.rows * rowHeight;
        if (index > 0) {
          laneG
            .append("line")
            .attr("x1", -MARGIN.left + 8)
            .attr("x2", innerWidth)
            .attr("y1", top)
            .attr("y2", top)
            .attr("stroke", "var(--border)")
            .attr("stroke-width", MARK_SPECS.axis.strokeWidth);
        }
        const laneLabel = laneG
          .append("text")
          .attr("x", -12)
          .attr("y", top + laneHeight / 2)
          .attr("text-anchor", "end")
          .attr("dominant-baseline", "middle")
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", MARK_SPECS.axis.tickFontSize)
          .text(lane.lane);

        // Truncated to the margin actually available, so a long lane name
        // is shortened rather than running off the left edge of the SVG
        // and being clipped mid-word. The estimate that sized the margin
        // is only an estimate; this is the guarantee. The untruncated name
        // stays reachable as a native tooltip.
        laneLabel.each(function () {
          const node = this as SVGTextElement;
          const available = MARGIN.left - 16;
          let text = lane.lane;
          while (text.length > 1 && node.getComputedTextLength() > available) {
            text = text.slice(0, -1);
            node.textContent = `${text}…`;
          }
          if (node.textContent !== lane.lane) {
            d3.select(node).append("title").text(lane.lane);
          }
        });
      }

      // Time axis along the bottom of the *plot*, which may be shorter than
      // the SVG when rows have pushed it taller — pinned to innerHeight so
      // it always sits directly under the last row.
      const axisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
      styleAxis(axisG, d3.axisBottom(x).ticks(Math.max(2, Math.floor(innerWidth / 90))));

      const barHeight = Math.max(6, rowHeight * ROW.barRatio);
      const barOffset = (rowHeight - barHeight) / 2;
      const allItems = layout.lanes.flatMap((lane) => lane.items);

      const barsG = g.append("g");
      const bars = barsG
        .selectAll<SVGGElement, LaidOutInterval>("g.timeline-bar")
        .data(allItems, (d) => d.id)
        .join("g")
        .attr("class", "timeline-bar");

      /** Left and right pixel edges of an item, clamped to the plot so a
       * bar that starts before the visible window still reads as running
       * off the edge rather than being drawn off-screen. */
      function edges(d: LaidOutInterval): [number, number] {
        const x0 = Math.max(0, Math.min(innerWidth, x(d.startDate)));
        const x1 = Math.max(0, Math.min(innerWidth, x(d.endDate)));
        // A one-day interval, or one zoomed out far enough to collapse,
        // still gets a visible sliver rather than a zero-width nothing.
        return [x0, Math.max(x1, x0 + 2)];
      }

      bars
        .append("path")
        .attr("class", "timeline-bar-shape")
        .attr("d", (d) => {
          const [x0, x1] = edges(d);
          // Rounded at the data end only, square where it starts — the
          // same grammar every bar in this app uses (marks.ts), just
          // horizontal. An ongoing interval is rounded at neither end: it
          // hasn't got a data end yet.
          return roundedBarPath(
            x0,
            d.absoluteRow * rowHeight + barOffset,
            x1 - x0,
            barHeight,
            d.ongoing ? "left" : "right",
          );
        })
        .attr("fill", (d) => colorFor(d))
        .attr("fill-opacity", 0.85);

      // Ongoing intervals get a solid stripe at their start edge and a
      // faded tail, so "still going" is carried by the mark itself rather
      // than only by the tooltip.
      bars
        .filter((d) => d.ongoing)
        .append("rect")
        .attr("aria-hidden", "true")
        .attr("x", (d) => edges(d)[0])
        .attr("y", (d) => d.absoluteRow * rowHeight + barOffset)
        .attr("width", ONGOING_STRIPE_WIDTH)
        .attr("height", barHeight)
        .attr("fill", (d) => colorFor(d));

      // Inline label, only where it fits — see MIN_LABEL_WIDTH.
      bars
        .filter((d) => {
          const [x0, x1] = edges(d);
          return x1 - x0 >= MIN_LABEL_WIDTH && barHeight >= 14;
        })
        .append("text")
        .attr("aria-hidden", "true")
        .attr("x", (d) => edges(d)[0] + 6)
        .attr("y", (d) => d.absoluteRow * rowHeight + rowHeight / 2)
        .attr("dominant-baseline", "middle")
        .style("font-size", MARK_SPECS.axis.tickFontSize)
        .style("pointer-events", "none")
        .text((d) => d.label)
        // Clip rather than overflow: a label that spills past its own bar
        // reads as belonging to the next one.
        .each(function (d) {
          const [x0, x1] = edges(d);
          const available = x1 - x0 - 12;
          const node = this as SVGTextElement;

          // Contrast is resolved per bar, against that bar's own painted
          // colour — see contrastingTextColor.
          const shape = (node.parentNode as Element | null)?.querySelector("path.timeline-bar-shape");
          node.setAttribute(
            "fill",
            contrastingTextColor(shape ? getComputedStyle(shape).fill : ""),
          );

          let text = d.label;
          while (text.length > 1 && node.getComputedTextLength() > available) {
            text = text.slice(0, -1);
            node.textContent = `${text}…`;
          }
        });

      attachMarkHover<LaidOutInterval>(
        bars as unknown as d3.Selection<d3.BaseType, LaidOutInterval, d3.BaseType, unknown>,
        {
          onHover: (item, clientPos) => setHovered({ item, color: colorFor(item), clientPos }),
          onLeave: () => setHovered(null),
        },
      );

      // Each bar gets its own accessible name — the whole point of
      // `attachMarkHover` making these focusable is that a keyboard user
      // hears something when they land on one.
      bars
        .attr("role", "img")
        .attr("aria-label", (d) =>
          d.ongoing
            ? `${d.lane}: ${d.label}, from ${formatDate(d.start, "dayYear")}, ongoing`
            : `${d.lane}: ${d.label}, ${formatDate(d.start, "dayYear")} to ${formatDate(d.end!, "dayYear")}`,
        );

      // Zoom/pan on x only. `translateExtent` keeps the data on screen —
      // without it a pan can fling the whole timeline into empty space
      // with no way back except a reset.
      const behavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 64])
        .extent([
          [0, 0],
          [innerWidth, Math.max(1, innerHeight)],
        ])
        .translateExtent([
          [0, 0],
          [innerWidth, Math.max(1, innerHeight)],
        ]);

      // Applied to the svg, and d3-zoom's own double-click handler removed
      // on the SELECTION rather than the generator — see
      // interactive-scroller.tsx's long comment for why the generator's
      // `.on("dblclick.zoom", null)` throws instead.
      const selection = svg.call(behavior).on("dblclick.zoom", null);

      // Push the window being drawn into d3-zoom's own transform, but ONLY
      // when the transform doesn't already say the same thing.
      //
      // The seeding itself is needed: a window set from outside (the range
      // slider, or a "since 2016" default) leaves d3's transform at
      // identity, so the next wheel tick would recompute from the full
      // extent and the view would jump.
      //
      // The guard is what makes it safe, and it is not optional. This
      // effect re-runs on every domain change — including the ones this
      // chart's own wheel-zoom just caused — and `behavior.transform`
      // reuses any gesture still live on the node. A wheel gesture stays
      // live for d3's wheelDelay (150ms) after the last tick, so re-seeding
      // during that window dispatches through the *previous* behavior's
      // listeners, which are still wired to setVisibleDomain: one wheel
      // tick became ~200 renders and React tore the page down with
      // "Maximum update depth exceeded". Comparing first means a
      // self-inflicted domain change seeds nothing, because the transform
      // already agrees.
      //
      // Compared in pixels rather than by date equality: the transform
      // round-trips through floating-point pixel maths, so the domain that
      // comes back is never exactly the one that went in.
      const baseX = d3.scaleTime().domain(fullDomain).range([0, innerWidth]);
      const node = selection.node();
      const target = visibleDomain ?? fullDomain;
      const targetSpanPx = baseX(target[1]) - baseX(target[0]);
      if (node && targetSpanPx > 0) {
        const [shown0, shown1] = d3.zoomTransform(node).rescaleX(baseX).domain() as [Date, Date];
        const alreadyShowing =
          Math.abs(baseX(shown0) - baseX(target[0])) < 0.5 &&
          Math.abs(baseX(shown1) - baseX(target[1])) < 0.5;
        if (!alreadyShowing) {
          const k = innerWidth / targetSpanPx;
          selection.call(
            behavior.transform,
            d3.zoomIdentity.translate(-baseX(target[0]) * k, 0).scale(k),
          );
        }
      }

      behavior.on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const [d0, d1] = event.transform.rescaleX(baseX).domain() as [Date, Date];
        setVisibleDomain(
          event.transform.k === 1
            ? null
            : [d0 < fullDomain[0] ? fullDomain[0] : d0, d1 > fullDomain[1] ? fullDomain[1] : d1],
        );
      });

      zoomRef.current = { behavior, selection };

      return () => {
        selection.on(".zoom", null);
        zoomRef.current = null;
      };
    },
    [layout, effectiveDomain, fullDomain, width, svgHeight, innerWidth, innerHeight, rowHeight, colorFor, MARGIN.left, MARGIN.top],
  );

  const resetZoom = useCallback(() => {
    if (zoomRef.current) {
      zoomRef.current.selection.call(zoomRef.current.behavior.transform, d3.zoomIdentity);
    }
    setVisibleDomain(null);
  }, [setVisibleDomain]);

  const containerRect = containerEl?.getBoundingClientRect();
  const zoomed = visibleDomain !== null;

  if (!layout.domain) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Nothing to plot yet.</p>
      </div>
    );
  }

  return (
    <div
      ref={setContainerEl}
      style={{
        position: "relative",
        width,
        height,
        display: "flex",
        flexDirection: "column",
        // `safe` matters here: a plain `center` centres an overflowing
        // child by pushing its top out of the scroll container, where it
        // can't be scrolled back to. `safe` falls back to start-alignment
        // exactly when the content is taller than the box.
        justifyContent: "safe center",
      }}
      // Scrolls only when rows have pushed the SVG past the height the
      // caller gave — see the module comment on sizing.
      className="overflow-y-auto"
    >
      <svg ref={ref} role="img" aria-label={ariaLabel} />
      {zoomed ? (
        <button
          type="button"
          onClick={resetZoom}
          className="absolute top-1 right-1 rounded-md border border-foreground/15 bg-card/90 px-2 py-0.5 text-xs text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Reset zoom
        </button>
      ) : null}
      {hovered && containerRect ? (
        <ChartTooltip
          x={hovered.clientPos.x - containerRect.left}
          y={hovered.clientPos.y - containerRect.top}
          title={hovered.item.label}
          rows={[
            {
              label: valueLabel,
              value: hovered.item.ongoing
                ? `${formatDate(hovered.item.start, "dayYear")} — now`
                : `${formatDate(hovered.item.start, "dayYear")} — ${formatDate(hovered.item.end!, "dayYear")}`,
              color: hovered.color,
              variant: "swatch",
            },
            {
              label: hovered.item.ongoing ? "so far" : "length",
              value: formatSpan(hovered.item.start, hovered.item.end ?? resolvedOpenEnd),
              color: hovered.color,
              variant: "swatch",
            },
          ]}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
