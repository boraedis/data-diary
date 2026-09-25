"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { drawStandardAxes } from "./axis";
import { Legend, useLegendHeight } from "./legend";
import { MARK_SPECS, roundedBarPath } from "./marks";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { categoricalColor } from "@/lib/viz/color";
import { formatPercent } from "@/lib/viz/format";
import { binSeries, type HistBucket } from "@/lib/viz/hist";

// InteractiveHist (#20) — the shared distribution-histogram primitive.
// The simplest of the core Interactive* primitives: generalizes
// HistogramChart (already close to this shape pre-#20 — d3.bin with
// domain-meaningful fixed thresholds, the toolkit's mark specs and hover
// pattern were already wired in as part of #17) into a reusable component
// with configurable bins/domain/color instead of a single one-off chart.
// Deliberately no zoom/brush here — a histogram's x-axis is a value
// range, not a timeline, so InteractiveLine's zoom vocabulary doesn't
// apply.
//
// Multi-series mode (`series`) draws several distributions on one set of
// buckets — happiness on work days against days off, say. Three ways to
// draw them (`mode`), because each answers a different question:
//
// - `overlaid`: raw counts, each series a translucent layer with a solid
//   step outline, so both shapes stay readable where they overlap.
// - `share`: the same overlay, but each bar is its share of *its own*
//   series. Two groups rarely have the same number of days (far more work
//   days than days off), and on raw counts the smaller one flattens into
//   the baseline — this is the mode that actually compares shapes.
// - `stacked`: counts stacked into one total, so the overall distribution
//   stays visible and each bar shows what it's made of.
//
// Hover is per *bucket* in multi-series mode, not per bar: overlaid bars
// sit on top of one another, so a per-bar hit target would only ever
// reach the front one. The whole bucket column is the target and the
// tooltip lists every series in it.

const DEFAULT_MARGIN = { top: 12, right: 16, bottom: 28, left: 36 };

/** Fill opacity for an overlaid layer — low enough that the layer behind
 * shows through, with the step outline carrying each series' exact shape. */
const OVERLAY_FILL_OPACITY = 0.45;
/** Vertical gap between stacked segments, px — the surface-gap rule from
 * MARK_SPECS, but thinner: a dense per-point histogram's segments are
 * often only a few px tall, and a 2px gap would eat them. */
const STACK_GAP = 1;
/** Line height for the mean labels, which stack down from the top of the
 * plot (one per series) so two means close together don't overprint. */
const MEAN_LABEL_LINE = 14;
const LEGEND_FALLBACK_HEIGHT = 24;
/** Module-level, not an inline default: `formatValue` is a `useD3`
 * dependency, and a fresh arrow per render would rebuild the SVG on every
 * hover. */
const formatOneDecimal = d3.format(".1f");
/** Id for the implicit series built from `values` in single-series mode. */
const SINGLE_ID = "__single__";

export type HistSeries = {
  id: string;
  /** Legend and tooltip label — plain text, never markup. */
  label: string;
  /** Fixed per series (`categoricalColor(i)` or a named slot) — it doesn't
   * change when another series is hidden. */
  color: string;
  values: number[];
};

export type HistMode = "overlaid" | "share" | "stacked";

type Hovered = { index: number; clientPos: { x: number; y: number } };

export type InteractiveHistProps = {
  /** Single-series input. Ignored when `series` is given. */
  values?: number[];
  /** Multi-series input — every series is counted against the same bucket
   * edges (see `binSeries`), drawn per `mode`, with a legend that toggles
   * each on and off. */
  series?: HistSeries[];
  /** How multiple series are drawn — see the file header. Ignored for a
   * single series. */
  mode?: HistMode;
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
  /** Single-series bar fill — a color (default: `categoricalColor(0)`) or a
   * function shading each bar by its own bucket (e.g. `viz/color`'s
   * `sequentialScale`, for a caller that wants magnitude read through
   * color as well as height). Multi-series colors come from each series. */
  color?: string | ((bucket: { x0: number; x1: number; count: number }, index: number) => string);
  /** Gap between adjacent bars, px — defaults to the toolkit's
   * `MARK_SPECS.bar.surfaceGap` (2px), the right amount for a chart with
   * few, wide bars. A histogram with many narrow buckets usually wants
   * this smaller (or the same, tight buckets already read as touching)
   * rather than inheriting a gap sized for a handful of category bars. */
  barGap?: number;
  /** Cap on individual bar thickness, px — defaults to the toolkit's
   * `MARK_SPECS.bar.maxThickness` (24px), which exists so a *category* bar
   * chart with few, wide slots doesn't turn into solid blocks. A
   * distribution histogram with many buckets is the opposite case: its
   * slots are usually already narrower than that cap, and when they
   * aren't (few buckets over a wide chart), letting bars run wider often
   * reads better than an arbitrary 24px ceiling. Pass `Infinity` (or omit
   * the cap's effect entirely) to let bars fill their slot minus `barGap`. */
  maxBarThickness?: number;
  xTicks?: number;
  yTicks?: number;
  /** Formats x-axis ticks — e.g. hours as "8h". Defaults to d3's own. */
  xTickFormat?: (value: number) => string;
  /** Formats a bucket's `[x0, x1)` range for the tooltip's title (the
   * "key" the count below belongs to) — defaults to `"x0–x1"`, collapsing
   * to a single `"x0"` when the bucket is exactly 1 wide (e.g. width-1
   * buckets over a discrete/integer value like happiness — "88–89" reads
   * as a range when the bucket really just means "the days someone
   * logged 88," a single value, not a range). */
  formatRange?: (x0: number, x1: number) => string;
  /** Label for the tooltip's count row, given the bucket's count — e.g.
   * `(n) => `day${n === 1 ? "" : "s"}`` for a per-day histogram like
   * happiness's. Defaults to the generic `"count"`. Single-series only;
   * multi-series rows are labelled with the series name. */
  countLabel?: (count: number) => string;
  /** Draws a dashed vertical line at each visible series' mean, labelled
   * with `formatValue` — the one summary number worth reading off a
   * comparison without hovering. */
  showMeans?: boolean;
  /** Formats a mean label's value. Defaults to one decimal place. */
  formatValue?: (value: number) => string;
  ariaLabel?: string;
  margin?: Partial<typeof DEFAULT_MARGIN>;
};

export function InteractiveHist({
  values,
  series,
  mode = "overlaid",
  width,
  height,
  thresholds,
  domain,
  color,
  barGap = MARK_SPECS.bar.surfaceGap,
  maxBarThickness = MARK_SPECS.bar.maxThickness,
  xTicks,
  yTicks = 5,
  xTickFormat,
  formatRange = (x0, x1) => (x1 - x0 === 1 ? `${x0}` : `${x0}–${x1}`),
  countLabel = () => "count",
  showMeans = false,
  formatValue = formatOneDecimal,
  ariaLabel = "Distribution histogram. Hover a bar to see its range and count.",
  margin,
}: InteractiveHistProps) {
  const isMulti = series !== undefined;
  const singleColor = typeof color === "string" ? color : categoricalColor(0);

  const allSeries = useMemo<HistSeries[]>(
    () => series ?? [{ id: SINGLE_ID, label: "", color: singleColor, values: values ?? [] }],
    [series, values, singleColor],
  );

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const toggleSeries = (id: string) =>
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const visibleSeries = useMemo(() => allSeries.filter((s) => !hiddenIds.has(s.id)), [allSeries, hiddenIds]);

  // Binned over *every* series, hidden or not, so the buckets and x-axis
  // stay put when a legend entry is toggled — only the bars change.
  const { buckets, totals } = useMemo(() => binSeries(allSeries, { domain, thresholds }), [allSeries, domain, thresholds]);

  // When `domain` isn't given, d3.bin still resolves *some* domain from
  // the data internally — read it back from the buckets rather than
  // re-deriving `d3.extent(values)` ourselves, so the x-axis always
  // matches exactly what the bars were actually bucketed against.
  const xDomain = useMemo<[number, number]>(
    () => domain ?? [buckets[0]?.x0 ?? 0, buckets[buckets.length - 1]?.x1 ?? 1],
    [domain, buckets],
  );

  const effectiveMode: HistMode = isMulti ? mode : "overlaid";
  const valueOf = useMemo(
    () =>
      (bucket: HistBucket, id: string): number => {
        const count = bucket.counts[id] ?? 0;
        if (effectiveMode !== "share") return count;
        return totals[id] ? count / totals[id] : 0;
      },
    [effectiveMode, totals],
  );

  const means = useMemo(
    () => (showMeans ? visibleSeries.map((s) => ({ series: s, mean: d3.mean(s.values) })) : []),
    [showMeans, visibleSeries],
  );

  const hasLegend = isMulti && allSeries.length >= 2;
  const [legendRef, legendHeight] = useLegendHeight(LEGEND_FALLBACK_HEIGHT);
  const plotHeight = Math.max(0, height - (hasLegend ? legendHeight : 0));

  const MARGIN = { ...DEFAULT_MARGIN, ...margin };
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = plotHeight - MARGIN.top - MARGIN.bottom;

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
      const yMax =
        effectiveMode === "stacked"
          ? (d3.max(buckets, (b) => d3.sum(visibleSeries, (s) => valueOf(b, s.id))) ?? 0)
          : (d3.max(visibleSeries, (s) => d3.max(buckets, (b) => valueOf(b, s.id))) ?? 0);
      const y = d3
        .scaleLinear()
        .domain([0, yMax || 1])
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", plotHeight)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      drawStandardAxes({
        g,
        x,
        y,
        innerWidth,
        innerHeight,
        xTicks,
        yTicks,
        xTickFormat: xTickFormat ? (v) => xTickFormat(Number(v)) : undefined,
        yTickFormat: effectiveMode === "share" ? (v) => formatPercent(Number(v)) : undefined,
      });

      // Cap thickness rather than filling the slot — the leftover width
      // becomes air on both sides, not a wider bar (see `maxBarThickness`'s
      // own doc comment on when a caller should raise or drop this cap
      // instead of taking the toolkit default).
      const barGeometry = (b: HistBucket) => {
        const slotX0 = x(b.x0);
        const slotX1 = x(b.x1);
        const slotWidth = Math.max(0, slotX1 - slotX0 - barGap);
        const barWidth = Math.min(slotWidth, maxBarThickness);
        return { barX: slotX0 + (slotX1 - slotX0 - barWidth) / 2, barWidth };
      };

      const barsG = g.append("g").attr("pointer-events", "none");
      // Outlines get their own group after the bars, so every series' step
      // edge paints above every translucent layer, not just its own.
      const outlinesG = g.append("g").attr("pointer-events", "none");

      if (effectiveMode === "stacked") {
        buckets.forEach((b) => {
          const { barX, barWidth } = barGeometry(b);
          const nonEmpty = visibleSeries.filter((s) => valueOf(b, s.id) > 0);
          let base = 0;
          nonEmpty.forEach((s, i) => {
            const top = base + valueOf(b, s.id);
            const isTop = i === nonEmpty.length - 1;
            // Every segment but the top one gives up STACK_GAP px at its
            // upper edge, so neighbours are separated by surface, not a
            // stroke; only the top segment gets the rounded data-end.
            const gap = isTop ? 0 : STACK_GAP;
            const segY = y(top) + gap;
            const segH = Math.max(0, y(base) - y(top) - gap);
            barsG
              .append("path")
              .attr("d", roundedBarPath(barX, segY, barWidth, segH, "up", isTop ? undefined : 0))
              .attr("fill", s.color)
              .attr("data-series", s.id);
            base = top;
          });
        });
      } else {
        visibleSeries.forEach((s) => {
          const fill = !isMulti && typeof color === "function" ? null : s.color;
          buckets.forEach((b, i) => {
            const v = valueOf(b, s.id);
            if (v <= 0) return;
            const { barX, barWidth } = barGeometry(b);
            barsG
              .append("path")
              .attr("d", roundedBarPath(barX, y(v), barWidth, innerHeight - y(v), "up"))
              .attr(
                "fill",
                fill ?? (color as Exclude<typeof color, string | undefined>)({ x0: b.x0, x1: b.x1, count: v }, i),
              )
              .attr("fill-opacity", isMulti ? OVERLAY_FILL_OPACITY : null)
              .attr("data-series", s.id);
          });
          if (!isMulti) return;
          // The step outline: the exact top edge of this series across
          // every bucket, down to the baseline at both ends — what keeps
          // a layer's shape legible where another layer covers it.
          const points: [number, number][] = [[x(buckets[0]?.x0 ?? 0), innerHeight]];
          for (const b of buckets) {
            const yv = y(valueOf(b, s.id));
            points.push([x(b.x0), yv], [x(b.x1), yv]);
          }
          points.push([x(buckets[buckets.length - 1]?.x1 ?? 0), innerHeight]);
          outlinesG
            .append("path")
            .attr("d", d3.line()(points))
            .attr("fill", "none")
            .attr("stroke", s.color)
            .attr("stroke-width", 1.5)
            .attr("stroke-linejoin", "round")
            .attr("data-outline", s.id);
        });
      }

      // Mean markers — dashed rule plus a label stacked down from the top,
      // one line per series, flipped to the rule's left near the right edge.
      means.forEach(({ series: s, mean }, i) => {
        if (mean === undefined) return;
        const mx = x(mean);
        if (mx < 0 || mx > innerWidth) return;
        const meanG = g.append("g").attr("pointer-events", "none");
        meanG
          .append("line")
          .attr("x1", mx)
          .attr("x2", mx)
          .attr("y1", 0)
          .attr("y2", innerHeight)
          .attr("stroke", s.color)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "4 3")
          .attr("data-mean", s.id);
        const flip = mx > innerWidth - 90;
        meanG
          .append("text")
          .attr("x", mx + (flip ? -4 : 4))
          .attr("y", 10 + i * MEAN_LABEL_LINE)
          .attr("text-anchor", flip ? "end" : "start")
          .attr("fill", s.color)
          .attr("font-size", MARK_SPECS.axis.tickFontSize)
          .attr("font-weight", 600)
          // A card-colored halo so the label stays legible over bars.
          .attr("stroke", "var(--card)")
          .attr("stroke-width", 3)
          .attr("paint-order", "stroke")
          .text(`${isMulti ? "avg " : "Average "}${formatValue(mean)}`);
      });

      // Per-bucket hit columns on top of everything: full plot height, so a
      // short (or zero) bar is as easy to hover as a tall one, and in
      // overlaid mode every layer in the bucket is reachable at once.
      const hover = g
        .append("g")
        .selectAll("rect")
        .data(buckets.map((b, i) => ({ b, i })))
        .join("rect")
        .attr("x", (d) => x(d.b.x0))
        .attr("y", 0)
        .attr("width", (d) => Math.max(0, x(d.b.x1) - x(d.b.x0)))
        .attr("height", innerHeight)
        .attr("fill", "var(--foreground)")
        .attr("fill-opacity", 0)
        .attr("tabindex", 0)
        .attr("data-bucket", (d) => d.i)
        .style("cursor", "pointer")
        .style("outline", "none");
      hover
        .on("pointerenter pointermove focus", function (event: Event, d) {
          d3.select(this).attr("fill-opacity", 0.06);
          const clientPos =
            event instanceof PointerEvent
              ? { x: event.clientX, y: event.clientY }
              : (() => {
                  const rect = (this as Element).getBoundingClientRect();
                  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                })();
          setHovered({ index: d.i, clientPos });
        })
        .on("pointerleave blur", function () {
          d3.select(this).attr("fill-opacity", 0);
          setHovered(null);
        });
    },
    [
      buckets,
      visibleSeries,
      valueOf,
      means,
      effectiveMode,
      isMulti,
      xDomain,
      width,
      plotHeight,
      innerWidth,
      innerHeight,
      xTicks,
      yTicks,
      xTickFormat,
      color,
      barGap,
      maxBarThickness,
      formatValue,
    ],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredBucket = hovered ? buckets[hovered.index] : undefined;

  let tooltipRows: TooltipRow[] = [];
  if (hoveredBucket && hovered) {
    if (!isMulti) {
      const count = hoveredBucket.counts[SINGLE_ID] ?? 0;
      tooltipRows = [
        {
          label: countLabel(count),
          value: `${count}`,
          color:
            typeof color === "function"
              ? color({ x0: hoveredBucket.x0, x1: hoveredBucket.x1, count }, hovered.index)
              : singleColor,
        },
      ];
    } else {
      // Stacked reads top-down in the tooltip the way it reads on screen.
      const ordered = effectiveMode === "stacked" ? [...visibleSeries].reverse() : visibleSeries;
      tooltipRows = ordered.map((s) => {
        const count = hoveredBucket.counts[s.id] ?? 0;
        return {
          label: effectiveMode === "share" ? `${s.label} (${count})` : s.label,
          value: effectiveMode === "share" ? formatPercent(valueOf(hoveredBucket, s.id), 1) : `${count}`,
          color: s.color,
          variant: "swatch",
        };
      });
    }
  }

  return (
    <div style={{ width, height }}>
      {hasLegend ? (
        // Padding (not margin) below the legend, so useLegendHeight's
        // measurement includes the gap — see that hook's own comment.
        <div ref={legendRef} className="pb-1.5">
          <Legend
            series={allSeries.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
            onToggle={toggleSeries}
            hiddenIds={hiddenIds}
          />
        </div>
      ) : null}
      <div
        ref={setContainerEl}
        style={{ position: "relative", width, height: plotHeight }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg ref={ref} />
        {hovered && hoveredBucket && containerRect && tooltipRows.length > 0 ? (
          // The bucket itself is the tooltip's title (the "key" — e.g. "88"
          // or "80–90"), bold via ChartTooltip's own title styling; the
          // rows below are the count(s), so hover reads unambiguously as
          // "bucket -> count" rather than same-weight numbers side by side
          // with no clear key/value relationship between them.
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={formatRange(hoveredBucket.x0, hoveredBucket.x1)}
            rows={tooltipRows}
            containerWidth={width}
          />
        ) : null}
      </div>
    </div>
  );
}
