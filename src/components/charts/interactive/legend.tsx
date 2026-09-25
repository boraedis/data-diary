import { useCallback, useMemo, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";
import { legendTicks } from "@/lib/viz/legend-ticks";

// Shared Legend component (#17's "shared Legend component" scope item).
// Fixed-order swatch + label rows — the dependable identity channel per
// the dataviz skill (marks-and-anatomy.md: "never make the reader rely on
// color-matching alone"). `<SeriesKey>` is exported separately because
// tooltip.tsx's row rendering needs the *same* swatch, just in its
// "line" variant (interaction.md: "line keys, not boxes" inside a
// tooltip, where a filled box would be data-weight ink doing a label's
// job) — one swatch implementation, two call sites, instead of two
// hand-drawn versions drifting apart.

export type SeriesKeyVariant = "swatch" | "line";

export function SeriesKey({
  color,
  variant = "swatch",
}: {
  /** A CSS color — typically `categoricalColor(i)` from `@/lib/viz/color`,
   * i.e. a `var(--chart-N)` reference, so it tracks light/dark mode. */
  color: string;
  variant?: SeriesKeyVariant;
}) {
  if (variant === "line") {
    return (
      <span
        aria-hidden
        className="inline-block h-0.5 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * The measured height of a legend's wrapper, for a chart that reserves room
 * for its legend out of a fixed height budget.
 *
 * The line and scroller primitives used to reserve one fixed row. That
 * holds until the legend wraps — nine subs plus a "30-day averages" entry
 * on a phone (#120) — and then the plot below overflows its box by a row.
 * Measuring the real wrapper keeps the budget honest at any width. Pass the
 * returned ref to the element wrapping `<Legend>`, with any gap below it as
 * *padding* on that wrapper so the measurement includes it.
 *
 * `fallback` is used until the first measurement lands, and permanently
 * where `ResizeObserver` doesn't exist (jsdom in tests), so a render there
 * lays out exactly as before this hook existed.
 */
export function useLegendHeight(fallback: number) {
  const [height, setHeight] = useState(fallback);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

export type LegendSeries = {
  /** Identifies this row for `onToggle`/`hiddenIds` — defaults to `label`
   * when omitted, so every existing non-interactive call site (which never
   * passed one) keeps working unchanged. Pass a real id when `label` isn't
   * guaranteed unique, or isn't a stable identifier (e.g. it can be
   * renamed) the way a category's own id is. */
  id?: string;
  /** Series name — rendered as plain JSX text (React escapes text
   * children the same way `textContent` does), never interpolated into
   * markup, since series names are user-entered data (tags, place names,
   * person names) per interaction.md. */
  label: string;
  color: string;
};

/**
 * Fixed categorical-order swatch + label row, always in the same left-to-
 * right order the series were given in (never re-sorted by value — color
 * follows the entity, not its rank). Renders nothing for a single series:
 * per marks-and-anatomy.md, "a box with one swatch restates the title and
 * costs space" — the chart's own title/subtitle already says what's
 * plotted, so callers don't need to gate this themselves.
 *
 * `onToggle` (added for #19's "click-to-toggle a category's visibility")
 * turns each row into a real toggle button instead of a static label —
 * every existing call site (InteractiveLine, InteractiveHist) omits it and
 * renders exactly as before. Toggling a row never reassigns anyone's
 * color: `series` always carries every row's original swatch regardless
 * of what's hidden, so hiding one category can't repaint the ones that
 * stay — the fixed-order color rule extends to "surviving after a
 * toggle," not just "surviving after a filter."
 */
export function Legend({
  series,
  className,
  onToggle,
  hiddenIds,
}: {
  series: LegendSeries[];
  className?: string;
  /** Presence of this prop is what makes the legend interactive — omit it
   * for a plain, non-clickable legend. Called with the toggled row's
   * `id` (or `label`, if no `id` was given). */
  onToggle?: (id: string) => void;
  /** ids currently hidden. Only meaningful alongside `onToggle`; ignored
   * otherwise. */
  hiddenIds?: ReadonlySet<string>;
}) {
  if (series.length < 2) return null;

  return (
    <div role="list" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {series.map((s) => {
        const id = s.id ?? s.label;
        const hidden = hiddenIds?.has(id) ?? false;
        const rowContent = (
          <>
            <SeriesKey color={s.color} variant="swatch" />
            <span className={hidden ? "line-through" : undefined}>{s.label}</span>
          </>
        );
        // A real <button>, not a clickable <div> — keyboard-operable by
        // default (Tab + Enter/Space), and aria-pressed is the non-color
        // signal for hidden/shown (the dimmed opacity + strikethrough
        // label are the visual ones) per marks-and-anatomy.md's "never
        // color alone."
        // When interactive, `role="listitem"` and `aria-pressed` can't
        // both live on one element (a listitem doesn't support the
        // pressed state per ARIA) — so the listitem role stays on a
        // plain wrapper, and the real `<button>` (implicit role="button",
        // which DOES support aria-pressed) lives inside it.
        return onToggle ? (
          <div key={id} role="listitem">
            <button
              type="button"
              aria-pressed={!hidden}
              onClick={() => onToggle(id)}
              className={cn(
                "flex items-center gap-1.5 text-xs transition-opacity",
                hidden ? "text-muted-foreground/50" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {rowContent}
            </button>
          </div>
        ) : (
          <div key={id} role="listitem" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {rowContent}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A sequential color scale's own legend — low value -> gradient bar -> high
 * value, with an optional indicator tick marking where a hovered/focused
 * point falls. Extracted from InteractiveCalendar (#21) so InteractiveGeo
 * (#24) and any future sequential-fill primitive share one implementation
 * instead of a second hand-rolled gradient swatch drifting from the first.
 *
 * Deliberately positioning-agnostic on its own — renders as a normal flow
 * row by default; `className`/`style` are how a caller opts into something
 * else (InteractiveCalendar's own `position: fixed` bottom-of-viewport
 * treatment, needed there because a multi-year calendar can scroll far
 * past the viewport; InteractiveGeo just renders it inline below the map,
 * whose height is already fixed and always on screen).
 */
export function SequentialLegend({
  domain,
  colorScale,
  sampleDomain,
  formatValue,
  valueT,
  swatches,
  ticks = "nice",
  scale = "linear",
  tickUnit,
  className,
  style,
}: {
  /** The scale's `[min, max]`. Labeled directly as the two ends in
   * `ticks="extent"` mode, and the range nice ticks are picked from
   * otherwise. */
  domain: [number, number];
  /** Any d3 sequential scale exposing `.interpolator()` (linear or log —
   * this component sampling t in [0,1] for the gradient bar doesn't care
   * which; only the *legend* row's own position-mapping would, and that's
   * `valueT`'s job, not this component's), and directly callable as
   * `colorScale(value)` — every real d3 sequential/diverging scale is both
   * at once. The direct-call form is what `sampleDomain` below uses. */
  colorScale: ((value: number) => string) & { interpolator(): (t: number) => string };
  /** When set, the gradient bar is built by sampling `colorScale(value)` at
   * evenly-spaced *values* across this range instead of the scale's raw
   * `interpolator(t)` at evenly-spaced `t`. Pass the same value range the
   * bar's own end labels (`domain`) describe when the color mapping isn't
   * a plain, unclamped linear scale across that exact range — a clamped
   * scale (the color domain narrower than the labeled domain, so the
   * outer stretch paints one flat pole color) or an asymmetric diverging
   * midpoint both need this to render honestly; a plain unclamped linear
   * scale over `domain` produces the same bar either way, so existing
   * callers can leave this unset. */
  sampleDomain?: [number, number];
  formatValue: (value: number) => string;
  /** Where a hovered/focused value falls along the gradient, as a 0-1
   * fraction — pass `null` to hide the indicator tick. The caller computes
   * this rather than this component deriving it from `domain`, since that
   * mapping depends on whether the underlying scale is linear or log (or,
   * with `sampleDomain` set, a plain linear fraction across it instead —
   * see the caller's own comment on how it derives this). */
  valueT: number | null;
  /** Discrete states that sit *outside* the gradient — a fill the scale
   * has no value for, like "no data" or #364's "travelled through".
   *
   * These exist because a sequential legend that only shows its ramp
   * silently under-documents a chart that paints more than the ramp. The
   * geo primitive has always had a muted no-data fill and never named it
   * anywhere but a tooltip, so a region you never hovered was simply
   * unexplained; adding a second off-ramp fill made that gap worse rather
   * than introducing it.
   *
   * Rendered after the gradient, in the order given, using the same
   * `SeriesKey` swatch the categorical `Legend` above uses — one swatch
   * implementation across both legends, per this file's own header. */
  swatches?: { label: string; color: string }[];
  /** `"nice"` (the default, #449) labels rounded values inside `domain`
   * with tick marks under the bar, the way an axis would. `"extent"`
   * labels the exact min and max at either end instead, for a chart
   * where the precise extremes are the point. Nice mode falls back to
   * the extent layout on its own when no two round values fit (see
   * `legendTicks`). */
  ticks?: "nice" | "extent";
  /** How positions along the bar map to values, so tick marks land where
   * the gradient actually paints that value. Must match how the bar is
   * sampled: `"log"` for a log color scale drawn from its raw
   * interpolator (the geo choropleths), `"linear"` otherwise, including
   * any caller passing `sampleDomain`. Ticks are placed across
   * `sampleDomain ?? domain`. */
  scale?: "linear" | "log";
  /** Round ticks in multiples of this. See `legendTicks`'s `unit`: a value
   * stored in minutes but formatted as hours wants `60`. */
  tickUnit?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Ten sampled stops (not just the two endpoints) — the interpolator
  // (interpolateHcl) isn't linear in sRGB, so a plain 2-stop CSS gradient
  // would visibly diverge from what the scale actually produces partway
  // through the ramp.
  const gradientStops = useMemo(() => {
    if (sampleDomain) {
      const [lo, hi] = sampleDomain;
      return d3.range(0, 1.0001, 0.1).map((t) => colorScale(lo + t * (hi - lo)));
    }
    const interpolate = colorScale.interpolator();
    return d3.range(0, 1.0001, 0.1).map((t) => interpolate(t));
  }, [colorScale, sampleDomain]);

  const tickValues = useMemo(
    () => (ticks === "nice" ? legendTicks(sampleDomain ?? domain, { scale, unit: tickUnit }) : null),
    [ticks, sampleDomain, domain, scale, tickUnit],
  );

  // The ramp is h-4, twice the h-2 it was before #449: a thin line made
  // the colour the reader is meant to match against the hardest thing on
  // the chart to see. The hover indicator stays taller than the bar so it
  // still reads as a marker riding on it, not a stripe painted into it.
  const bar = (
    <span className="relative block h-4">
      <span
        aria-hidden
        className="block h-4 w-full rounded-full"
        style={{ background: `linear-gradient(to right, ${gradientStops.join(", ")})` }}
      />
      {valueT !== null ? (
        <span
          aria-hidden
          className="absolute top-1/2 h-6 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm"
          style={{ left: `${valueT * 100}%` }}
        />
      ) : null}
    </span>
  );

  // `shrink-0` on each row, and wrapping allowed on the container, so a
  // narrow map drops these below the bar rather than crushing the
  // gradient — the bar is `flex-1` and would otherwise give up all its
  // width to them first.
  const swatchRows = swatches?.length
    ? swatches.map((s) => (
        <span key={s.label} className="flex shrink-0 items-center gap-1.5">
          <SeriesKey color={s.color} variant="swatch" />
          {s.label}
        </span>
      ))
    : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground", className)} style={style}>
      {tickValues ? (
        <span className="min-w-0 flex-1">
          {bar}
          {/* Labels at the bar's very ends are aligned inward rather than
              centred on their tick, or they'd hang half outside the
              legend (and, for the calendar's fixed legend, off the card). */}
          <span className="relative mt-0.5 block h-6">
            {tickValues.map(({ value, t }) => (
              <span
                key={value}
                className={cn(
                  "absolute top-0 flex flex-col tabular-nums",
                  t < 0.02 ? "items-start" : t > 0.98 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center",
                )}
                style={{ left: `${t * 100}%` }}
              >
                <span aria-hidden className="h-1.5 w-px bg-muted-foreground/60" />
                <span className="leading-tight">{formatValue(value)}</span>
              </span>
            ))}
          </span>
        </span>
      ) : (
        <>
          <span className="shrink-0 tabular-nums">{formatValue(domain[0])}</span>
          <span className="min-w-0 flex-1">{bar}</span>
          <span className="shrink-0 tabular-nums">{formatValue(domain[1])}</span>
        </>
      )}
      {swatchRows}
    </div>
  );
}
