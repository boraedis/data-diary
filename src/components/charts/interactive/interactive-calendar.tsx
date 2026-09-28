"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { MARK_SPECS, attachMarkHover } from "./marks";
import { ChartTooltip } from "./tooltip";
import { SequentialLegend } from "./legend";
import { divergingScale, sequentialScale, type ColorMode } from "@/lib/viz/color";
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
// 20 rather than 18 to fit #449's larger (15px year / 13px month) labels.
const YEAR_LABEL_HEIGHT = 20;
const YEAR_GAP = 14;
// Single-letter day labels ("M"/"T"/"W"/...) need much less horizontal
// room than 3-letter abbreviations would, so most of this column's width
// is unused by them — it's sized instead for the year number, which is
// right-anchored against the grid's edge (see the `g.append("text")` call
// below) and needs enough room for 4 digits without bleeding into
// January's month label just to its right. 40 rather than 30 since #449
// raised the year to 15px: a 4-digit year at that size is ~34px wide
// plus its 6px gap, and at 30 it hung past the column into the SVG's
// left edge whenever the grid was too wide to leave any centring offset.
const LEFT_LABEL_WIDTH = 40;
// Monday-first — see the module comment above. Index 0 = Monday, matching
// the `dow` remap below ((getDay() + 6) % 7).
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
/** Monday=0..Sunday=6. getDay() is Sunday=0..Saturday=6, so shift by 6
 * mod 7 to match DAY_LABELS's "M,T,W,T,F,S,S" order. */
const mondayIndex = (date: Date) => (date.getDay() + 6) % 7;
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
// The narrowest width the horizontal layout fits at MIN_CELL_SIZE (570px).
// Below it the calendar switches to a month grid (#450) instead of
// overflowing: on a phone the horizontal strip ran out around August, and
// the scroll that was meant to reach the rest was clipped by ChartCard's
// overflow. Keyed off the measured width, not the user agent, so a narrow
// desktop window gets the same treatment. Any width that already fit keeps
// the horizontal layout pixel-for-pixel.
const HORIZONTAL_MIN_WIDTH = LEFT_LABEL_WIDTH + WEEKS_PER_YEAR * (MIN_CELL_SIZE + CELL_GAP);

// Month-grid layout (#450): each year becomes twelve small month calendars,
// three or more across, like a phone calendar's year view. Years stack down
// the page, most recent first. The user picked this from mockups. Two
// earlier attempts were rejected. One was the horizontal strip turned on its
// side (weeks running down, years tiled side by side), which read as tall,
// ragged columns. The others mocked were month rows × day-of-month columns,
// and the desktop strip folded into two half-years.
//
// Months don't share a continuous week grid: each month starts its own
// Monday-first grid, so a week that spans a month boundary appears in both
// months (the half in each). That's what makes each month read as a
// calendar, and it's the same convention every phone calendar uses.
const M_YEAR_LABEL_HEIGHT = 26;
const M_MONTH_LABEL_HEIGHT = 18;
const M_MONTH_GAP_X = 14;
const M_MONTH_GAP_Y = 10;
const M_YEAR_GAP = 20;
// A month is at most 6 Monday-first week rows (a 31-day month starting on
// Saturday or Sunday).
const M_WEEK_ROWS = 6;
// Months per row, widest first. 12 divides evenly by each, so every year's
// grid is a clean rectangle. The first option whose cells come out at least
// M_PREFERRED_CELL_SIZE wins; a phone lands on 3.
const M_COLUMN_OPTIONS = [6, 4, 3];
const M_PREFERRED_CELL_SIZE = 12;
// Caps the cells when there's width to spare (a lone year on a ~560px
// window would otherwise hit MAX_CELL_SIZE), so a year stays about one
// screen tall. The grid is centred instead of stretched.
const M_MAX_CELL_SIZE = 16;

type LayoutCommon = {
  cellSize: number;
  rowHeight: number;
  totalHeight: number;
  /** Width of the drawn content (labels + grid), centred in `width` by
   * `outerOffset`. */
  contentWidth: number;
  outerOffset: number;
  /** The legend's left edge and width, relative to the container. It spans
   * only the grid in horizontal mode (see the legend's own comment) and
   * the whole month grid in months mode. */
  legendLeft: number;
  legendWidth: number;
};

type CalendarLayout =
  | (LayoutCommon & {
      orientation: "horizontal";
      /** Translation of year `i`'s grid origin (its first cell's top-left). */
      gridOrigin: (i: number) => { x: number; y: number };
    })
  | (LayoutCommon & {
      orientation: "months";
      columns: number;
      /** Translation of year `i`'s block (its year label's top-left). */
      yearOrigin: (i: number) => { x: number; y: number };
      /** Month `m`'s (0-11) grid origin, relative to its year's block. */
      monthOrigin: (m: number) => { x: number; y: number };
    });

/**
 * Where everything goes for a given width and year count. Pure, so the
 * layout switch is testable without a DOM.
 */
export function calendarLayout(width: number, yearCount: number): CalendarLayout {
  if (width >= HORIZONTAL_MIN_WIDTH) {
    // Purely width-driven: floor(available / WEEKS_PER_YEAR) minus the
    // inter-cell gap, clamped to a legible-but-not-huge range. No
    // disconnected "guess" constant feeding this (see MIN/MAX_CELL_SIZE's
    // comment above) — this is the one and only place cellSize is
    // computed, from the real measured `width`.
    const cellSize = Math.min(
      MAX_CELL_SIZE,
      Math.max(MIN_CELL_SIZE, Math.floor((width - LEFT_LABEL_WIDTH) / WEEKS_PER_YEAR) - CELL_GAP),
    );
    const rowHeight = cellSize + CELL_GAP;
    const yearBlockHeight = 7 * rowHeight;
    // The day-of-week label column and the day grid are ONE visual unit —
    // center that whole unit in the available width, rather than centering
    // the grid alone and leaving the labels pinned to the container's edge
    // (which is what the previous version did, and what read as the labels
    // being "detached" from the grid: as the grid shifted to center itself,
    // the label column stayed put and a gap opened up between them). Both
    // the label column and the grid live inside the same translated `g`
    // below, so they now move together by construction.
    const gridWidth = WEEKS_PER_YEAR * rowHeight;
    const contentWidth = LEFT_LABEL_WIDTH + gridWidth;
    const outerOffset = Math.max(0, (width - contentWidth) / 2);
    const gridLeft = outerOffset + LEFT_LABEL_WIDTH;
    return {
      orientation: "horizontal",
      cellSize,
      rowHeight,
      totalHeight: yearCount * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP),
      contentWidth,
      outerOffset,
      legendLeft: gridLeft,
      // Clamped to the container's own visible width, not `gridWidth`
      // outright — see the legend's comment below. Above
      // HORIZONTAL_MIN_WIDTH, `width - LEFT_LABEL_WIDTH >= gridWidth`
      // always holds, so this is now a no-op kept as a guard.
      legendWidth: Math.min(gridWidth, Math.max(0, width - LEFT_LABEL_WIDTH)),
      gridOrigin: (i) => ({
        x: gridLeft,
        y: i * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP) + YEAR_LABEL_HEIGHT,
      }),
    };
  }

  const cellAt = (columns: number) =>
    Math.floor((width - (columns - 1) * M_MONTH_GAP_X) / columns / 7) - CELL_GAP;
  const columns = M_COLUMN_OPTIONS.find((c) => cellAt(c) >= M_PREFERRED_CELL_SIZE) ?? 3;
  const cellSize = Math.min(M_MAX_CELL_SIZE, Math.max(MIN_CELL_SIZE, cellAt(columns)));
  const rowHeight = cellSize + CELL_GAP;
  const monthWidth = 7 * rowHeight - CELL_GAP;
  const monthHeight = M_MONTH_LABEL_HEIGHT + M_WEEK_ROWS * rowHeight;
  const monthRows = 12 / columns;
  const yearHeight = M_YEAR_LABEL_HEIGHT + monthRows * monthHeight + (monthRows - 1) * M_MONTH_GAP_Y;
  const contentWidth = columns * monthWidth + (columns - 1) * M_MONTH_GAP_X;
  const outerOffset = Math.max(0, (width - contentWidth) / 2);
  return {
    orientation: "months",
    columns,
    cellSize,
    rowHeight,
    totalHeight: yearCount * yearHeight + Math.max(0, yearCount - 1) * M_YEAR_GAP,
    contentWidth,
    outerOffset,
    legendLeft: outerOffset,
    legendWidth: Math.min(contentWidth, width),
    yearOrigin: (i) => ({ x: outerOffset, y: i * (yearHeight + M_YEAR_GAP) }),
    monthOrigin: (m) => ({
      x: (m % columns) * (monthWidth + M_MONTH_GAP_X),
      y: M_YEAR_LABEL_HEIGHT + Math.floor(m / columns) * (monthHeight + M_MONTH_GAP_Y) + M_MONTH_LABEL_HEIGHT,
    }),
  };
}

/**
 * Converts an `oklch(L C H)` string to a `#rrggbb` hex string d3-color can
 * actually parse. Standard OKLab -> linear-sRGB -> gamma-encoded-sRGB
 * matrices (Björn Ottosson's published constants — the same conversion
 * every oklch-to-sRGB implementation uses); `L`/`C`/`H` are the raw numbers
 * as this app's own `globals.css` writes them (`L` a 0-1 fraction, not a
 * percentage — this codebase never uses the percentage form). An optional
 * `/ alpha` component is accepted and ignored: every color this function
 * actually sees (this app's own `--chart-1..5` tokens) is fully opaque, and
 * `blendColors` below has no channel to carry per-entry opacity through
 * anyway. Returns `null` for anything that isn't `oklch(...)` syntax, so
 * the caller can fall back to the original string unchanged.
 */
function oklchToHex(value: string): string | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i.exec(value.trim());
  if (!match) return null;
  const [, lStr, cStr, hStr] = match;
  const L = Number(lStr);
  const C = Number(cStr);
  const Hdeg = Number(hStr);
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(Hdeg)) return null;
  const H = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const rLinear = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const gamma = (x: number) => {
    const clamped = Math.min(1, Math.max(0, x));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };
  const toHex = (x: number) => Math.round(gamma(x) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rLinear)}${toHex(gLinear)}${toHex(bLinear)}`;
}

/**
 * Converts a CSS `lab(L% a b)` string to a `#rrggbb` hex string. `L` is a
 * percentage (0%-100%, matching CIE Lab's own 0-100 scale exactly — CSS
 * just spells it with a `%`); `a`/`b` are plain numbers, same convention
 * `d3.lab(l, a, b)` already uses, so this is a much shorter conversion than
 * `oklchToHex` above — no matrix math, just strip the `%` and hand the
 * three numbers to d3's own Lab constructor. Returns `null` for anything
 * that isn't `lab(...)` syntax. See `resolveCssColor`'s own comment for why
 * this format is the one that actually matters at runtime.
 */
function cssLabToHex(value: string): string | null {
  const match = /^lab\(\s*([\d.]+)%\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i.exec(value.trim());
  if (!match) return null;
  const [, lStr, aStr, bStr] = match;
  const L = Number(lStr);
  const a = Number(aStr);
  const b = Number(bStr);
  if (!Number.isFinite(L) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return d3.lab(L, a, b).formatHex();
}

/**
 * Resolves a category color into something d3-color can actually parse,
 * for the one place in this component that needs to do real math on a
 * color rather than just paint it: `blendColors` below does Lab-space
 * averaging, and `d3.color()` (which `d3.lab()` calls internally) can't
 * parse any of the three things a `categoricalColor()` string
 * (`@/lib/viz/color` — `var(--chart-1)` etc., specifically meant to be set
 * directly as a `fill` attribute and resolved by the browser's own CSS
 * engine, not read back into JS) turns out to actually be, at each step of
 * resolving it:
 *
 * 1. A `var(--custom-property)` reference — resolving one needs the CSSOM,
 *    not a color-string parser, so `d3.color("var(--chart-1)")` returns
 *    `null` outright.
 * 2. This app's own token values are *authored* as `oklch(...)` in
 *    `globals.css` — also unparseable by this project's d3 version. A
 *    first attempt at this fix handled step 1 but assumed the resolved
 *    value would still be that literal oklch() text.
 * 3. It isn't: `getComputedStyle(...).getPropertyValue('--chart-N')`
 *    doesn't hand back the author's source text unchanged — verified live
 *    in a real browser against this app's actual deployment, since this is
 *    exactly the step both earlier attempts got wrong by assuming instead
 *    of checking. The browser normalizes the recognized `oklch()` function
 *    into an equivalent CSS `lab(L% a b)` serialization, a *third* syntax
 *    `d3.color()` doesn't recognize either — so the second attempt's fix
 *    (oklch parsing) never even ran, because its own regex never matched
 *    what the property actually contained by the time JS saw it.
 *
 * Every failure mode above is silent (`d3.color()` never throws, just
 * returns `null`), so every category's Lab came back `{l: NaN, a: NaN, b:
 * NaN}` at every one of these three attempts, got filtered out by
 * `blendColors`' own `labs.length === 0` guard, and every blend fell
 * through to the same fixed fallback color — regardless of the day's
 * actual category. Not caught by `PeopleCalendarChart` (this primitive's
 * other blend-mode consumer) because tag colors there are literal hex
 * strings straight from the database (`tags.color`), never a `var()`
 * token — `DayTypeCalendarChart` (#410) is the first caller to hand this a
 * `categoricalColor()` string. Input that's already parseable (a plain
 * hex/rgb string, or literally either color function without the `var()`
 * wrapper) passes through / converts directly. Safe to call unconditionally
 * (no SSR guard needed): every call site is inside a D3 render callback or
 * a hover handler, both of which only ever run after mount, in the browser.
 */
export function resolveCssColor(color: string): string {
  const varMatch = /^var\((--[\w-]+)\)$/.exec(color.trim());
  const raw = varMatch
    ? getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim() || color
    : color;
  return cssLabToHex(raw) ?? oklchToHex(raw) ?? raw;
}

export type InteractiveCalendarPoint = {
  date: string; // "YYYY-MM-DD"
  value: number;
  /**
   * Optional per-category breakdown for the day. When present and
   * non-empty, the cell is filled with the perceptual blend of these
   * colors instead of the sequential ramp, and the tooltip lists them.
   *
   * This is what lets a calendar answer "which *kinds* of thing was this
   * day made of" rather than only "how much" — a day shared between two
   * tagged groups of people reads as a mix of their colors, not as the
   * number 2. The value is still required and still drives the tooltip's
   * numeric row, so a blended calendar keeps its magnitude reading too.
   *
   * `weight` biases the mix. Omit it where each category counts the same
   * (tagged groups of people: one entry per group, present or not), and
   * pass it where the split itself is the point (minutes on phone against
   * minutes on laptop — a day spent mostly on one should look mostly like
   * that one, not like an even mix).
   *
   * `value` is optional tooltip text shown beside the category's name — for
   * a weighted mix where the weight itself is worth reading (each sub's
   * score behind a subs-calendar day, #120). Omit it where the category's
   * presence is the whole story (a tagged group was there or it wasn't).
   */
  categories?: { label: string; color: string; weight?: number; value?: string }[];
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
  /** When set, cells use a diverging (cool/warm) scale centered on this
   * value instead of the default single-hue sequential ramp — e.g. a
   * fixed target duration, where below and above the target are two
   * different meanings rather than just "more". Clamped into the data's
   * own `[min, max]` if the target falls outside it. Ignored in blend
   * mode (`categories`), which always paints from the sequential ramp's
   * low end. Ignored when `colorInterpolator` is set (see below). */
  divergingMidpoint?: number;
  /** Escape hatch to a caller-supplied `(t: number) => string` interpolator
   * (any d3-scale-chromatic function, e.g. `d3.interpolateRdYlBu`), mapped
   * over the data's own `[min, max]` as a plain sequential scale — bypasses
   * `sequentialScale`/`divergingScale`/`colorMode`/`divergingMidpoint`
   * entirely. This app's own charts should reach for those instead (see
   * viz/color.ts's own header comment on why: fixed, colorblind-validated,
   * "this app's own colors" rather than a borrowed generic ramp) — one real
   * exception already exists: for a caller switching between several
   * related metrics (a "Measure" picker), pair this with `@/lib/viz/color`'s
   * `categorySequentialInterpolator` so each metric gets its own hue rather
   * than this component's single default ramp (`technology-charts.tsx`'s
   * screen-time calendar). The other exists for
   * sleep-calendar-chart.tsx's legacy-authentic mode, where matching the
   * original app's exact `d3.interpolateRdYlBu` look was the explicit ask,
   * not a new default worth branding. */
  colorInterpolator?: (t: number) => string;
  /** Shrinks the color domain inward by this amount on each side (in the
   * same units as `value`), clamped so anything at or beyond that inset
   * boundary paints the same fully-saturated pole color instead of a
   * fainter, less-differentiated one. A calendar spanning a few genuine
   * outliers (one very short night, one very long one) otherwise spends
   * most of its color range on those rare extremes and leaves the
   * densely-populated middle looking flat — this trades that off
   * deliberately: differences among the *common* values get more of the
   * gradient's visual range, at the cost of the true extremes no longer
   * being distinguishable from "merely quite extreme." The legend's
   * low/high text labels still show the data's real, un-inset min/max —
   * only the color mapping (and its hover indicator) is inset. */
  domainInset?: number;
  /** Blend mode only: the value at which a blended cell reaches full
   * colour, instead of the data's own max. A history whose maximum is a
   * rare outlier (a subs day totalling 30 when the median is 5, #120)
   * otherwise spends the whole intensity range on that one day and paints
   * every ordinary day faint. Values at or above the cap all show full
   * colour; the tooltip still reports the real value. Ignored outside
   * blend mode, where `domainInset` does the equivalent job for the
   * sequential ramp. */
  blendIntensityCap?: number;
  /** `SequentialLegend`'s `ticks` — rounded "nice" ticks by default
   * (#449), or `"extent"` to label the exact min and max instead. */
  legendTicks?: "nice" | "extent";
  /** `SequentialLegend`'s `tickUnit`, for a value stored in a smaller unit
   * than it's read in — sleep passes 60 so its minutes tick on whole
   * hours. */
  legendTickUnit?: number;
  ariaLabel?: string;
};

type YearGroup = { year: number; days: Map<string, { value: number; categories: DayCategories }> };
type DayCategories = { label: string; color: string; value?: string }[] | undefined;
type CellDatum = { dateStr: string; value: number; categories: DayCategories; x: number; y: number };
type Hovered = {
  dateStr: string;
  value: number;
  categories: DayCategories;
  clientPos: { x: number; y: number };
};
type MonthTick = { label: string; week: number };

export function InteractiveCalendar({
  points,
  width,
  formatValue,
  valueLabel = "value",
  colorMode = "dark",
  divergingMidpoint,
  colorInterpolator,
  domainInset,
  blendIntensityCap,
  legendTicks,
  legendTickUnit,
  ariaLabel = "Calendar heatmap. Hover a day to see its value.",
}: InteractiveCalendarProps) {
  const years = useMemo<YearGroup[]>(() => {
    const byYear = new Map<number, Map<string, { value: number; categories: DayCategories }>>();
    for (const p of points) {
      const year = parseInt(p.date.slice(0, 4), 10);
      if (!byYear.has(year)) byYear.set(year, new Map());
      byYear.get(year)!.set(p.date, { value: p.value, categories: p.categories });
    }
    // Most recent year first (top of the stack) — per user feedback; a
    // reader scanning down wants "now" first, not the oldest year on file.
    return [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, days]) => ({ year, days }));
  }, [points]);

  const layout = useMemo(() => calendarLayout(width, years.length), [width, years.length]);

  const domain = useMemo<[number, number]>(() => {
    const [lo, hi] = d3.extent(points, (p) => p.value);
    if (lo === undefined || hi === undefined) return [0, 1];
    return lo === hi ? [lo - 1, lo + 1] : [lo, hi];
  }, [points]);

  // The color domain, shrunk inward by `domainInset` if set — see that
  // prop's own doc comment. Falls back to the true `domain` if the inset
  // would invert it (a tighter inset than the data actually spans), rather
  // than collapsing to a degenerate single-point domain.
  const colorDomain = useMemo<[number, number]>(() => {
    if (!domainInset) return domain;
    const [lo, hi] = domain;
    const inset = Math.min(domainInset, (hi - lo) / 2);
    const insetLo = lo + inset;
    const insetHi = hi - inset;
    return insetLo < insetHi ? [insetLo, insetHi] : domain;
  }, [domain, domainInset]);

  // The clamped midpoint actually used for the diverging domain — a fixed
  // target (e.g. an 8h sleep goal) can easily fall outside the color
  // domain's own [min, max] (someone who never sleeps under 8h clamps the
  // cool half away entirely), and d3.scaleDiverging expects its domain
  // triple monotonic, not an arbitrary midpoint. Meaningless (and unused)
  // when `colorInterpolator` is set, which is always a plain sequential
  // mapping over the color domain regardless of any target.
  const clampedMidpoint =
    divergingMidpoint === undefined
      ? undefined
      : Math.min(Math.max(divergingMidpoint, colorDomain[0]), colorDomain[1]);

  // `.clamp(true)` is what actually makes `domainInset` do anything: every
  // real value still gets mapped through this same scale, so without
  // clamping, a value outside `colorDomain` would extrapolate the
  // interpolator past t=0/t=1 instead of pinning to the pole color the
  // inset is supposed to reserve for it.
  const colorScale = useMemo(
    () =>
      (colorInterpolator !== undefined
        ? d3.scaleSequential(colorDomain, colorInterpolator)
        : clampedMidpoint === undefined
          ? sequentialScale(colorDomain, colorMode)
          : divergingScale([colorDomain[0], clampedMidpoint, colorDomain[1]], colorMode)
      ).clamp(true),
    [colorDomain, colorMode, clampedMidpoint, colorInterpolator],
  );

  /**
   * Maps a value to its 0-1 position along the legend gradient. The legend
   * bar itself (`SequentialLegend`'s `sampleDomain` below) is built by
   * sampling `colorScale(value)` at evenly-spaced *values* across the
   * true, un-inset `domain` — not the scale's raw `interpolator(t)` at
   * evenly-spaced `t`, which is what makes an inset/clamped or
   * asymmetric-diverging scale render its flat clamped ends and true
   * midpoint position honestly instead of stretching them edge-to-edge.
   * Because the bar's x-axis is therefore just "linear position across
   * `domain`" by construction, this indicator only needs to match that
   * same plain linear fraction — no separate diverging-halves math, and no
   * risk of drifting out of sync with what the bar actually paints at that
   * position, since both this and the bar sample the identical `domain`
   * and `colorScale`.
   */
  const valueToT = useCallback(
    (value: number): number => {
      const [lo, hi] = domain;
      const span = hi - lo;
      return span > 0 ? Math.min(1, Math.max(0, (value - lo) / span)) : 1;
    },
    [domain],
  );

  // A calendar is in blend mode as soon as any day carries a breakdown.
  // It's all-or-nothing rather than per-cell because the legend below has
  // to describe one encoding or the other — a grid where some cells mean
  // "how much" and others mean "which kinds" can't be read.
  const blended = useMemo(() => points.some((p) => (p.categories?.length ?? 0) > 0), [points]);

  // Whether `points` actually has a real value spread, as opposed to every
  // point sharing one constant value (DayTypeCalendarChart's `value: 1` on
  // every cell, deliberately — see its own comment: there's no magnitude to
  // show when a day has exactly one type). `domain` above pads a
  // zero-width span out to `[lo-1, lo+1]` so the *sequential* ramp still
  // has two distinct endpoints to draw a legend between — but blend mode's
  // intensity calc below was reusing that same padded domain to place a
  // constant value at its midpoint (t=0.5, "60% MIN_INTENSITY-ward")
  // instead of at the top, quietly contradicting the "equal values render
  // every day at full intensity" behavior every blend-mode consumer's own
  // comment already documents and assumes. Tracked separately from
  // `domain` itself so the padding stays available for the modes that
  // actually need it.
  const hasValueSpan = useMemo(() => {
    const [lo, hi] = d3.extent(points, (p) => p.value);
    return lo !== undefined && hi !== undefined && lo !== hi;
  }, [points]);

  /**
   * Averages colors in CIELAB rather than sRGB.
   *
   * Averaging hex channels directly is what makes mixed colors look muddy:
   * sRGB isn't perceptually uniform, so the midpoint of two vivid hues
   * lands darker and duller than either. Lab averages roughly the way
   * seeing does. (OKLab would be marginally better still, but d3-color
   * ships Lab and is already a dependency — not worth a new one here.)
   *
   * Legacy did this differently, by painting one translucent rect per
   * person and letting the browser composite them, with a recursive alpha
   * sequence so each contributed equally. Same intent; this version is one
   * rect instead of N, doesn't depend on draw order, and doesn't drift
   * toward the background as the count grows.
   *
   * A day mixing many categories does trend toward a neutral mid-tone.
   * That's left as-is rather than capped: "this day was a bit of
   * everything" is a true thing to say about it, and the tooltip carries
   * the exact breakdown regardless.
   */
  const blendColors = (entries: { color: string; weight?: number }[]): string => {
    const labs = entries
      .map((e) => ({ lab: d3.lab(resolveCssColor(e.color)), weight: e.weight ?? 1 }))
      .filter((e) => !Number.isNaN(e.lab.l) && e.weight > 0);
    if (labs.length === 0) return "var(--muted)";
    const total = labs.reduce((sum, e) => sum + e.weight, 0);
    const mix = (get: (lab: d3.LabColor) => number) =>
      labs.reduce((sum, e) => sum + get(e.lab) * e.weight, 0) / total;
    return d3.lab(mix((c) => c.l), mix((c) => c.a), mix((c) => c.b)).formatHex();
  };

  /**
   * How much of the blended hue a cell shows, from its own value.
   *
   * A flat blend would throw away magnitude: a day with one person and a
   * day with seven from the same group would look identical, and the
   * calendar would stop answering "how much" entirely. Legacy got this for
   * free — stacking one translucent rect per person meant more people
   * literally painted more colour over the background — and blending to a
   * single fill loses it unless it's put back deliberately.
   *
   * So the hue says *which kinds*, and the intensity still says *how many*.
   * The cell is interpolated from the sequential ramp's own low end toward
   * the blend, which keeps a quiet day in a blended calendar at the same
   * visual weight as a quiet day in a plain one.
   *
   * The floor matters: at zero the hue would be invisible and the whole
   * point of the mode lost on exactly the days that have only one category
   * to show. Starting at 40% keeps a single-person day clearly coloured
   * while leaving real headroom above it.
   */
  const MIN_INTENSITY = 0.4;

  const cellFill = useCallback(
    (value: number, categories: DayCategories): string => {
      if (!categories || categories.length === 0) return colorScale(value);
      const blend = blendColors(categories);
      // `hasValueSpan` short-circuits straight to full intensity (`t = 1`)
      // regardless of `blendIntensityCap`: a cap only means something when
      // there's a real spread to cap the top of — DayTypeCalendarChart's
      // constant `value: 1` on every cell (see `hasValueSpan`'s own
      // comment) has no such spread, so there's nothing for a cap to do.
      const top = blendIntensityCap !== undefined ? Math.min(domain[1], blendIntensityCap) : domain[1];
      const span = top - domain[0];
      const t = !hasValueSpan ? 1 : span > 0 ? (value - domain[0]) / span : 1;
      const intensity = MIN_INTENSITY + (1 - MIN_INTENSITY) * Math.min(1, Math.max(0, t));
      return d3.interpolateLab(colorScale(domain[0]), blend)(intensity);
    },
    [colorScale, domain, hasValueSpan, blendIntensityCap],
  );

  const [hovered, setHovered] = useState<Hovered | null>(null);
  // State-backed callback ref, not a plain useRef — see interactive-hist.tsx's
  // identical comment: getBoundingClientRect() below runs during render (to
  // position the tooltip from a hover's *client* coordinates), and reading
  // a plain ref's `.current` during render is what this project's lint
  // rule (correctly) warns against.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // Hover → tap on touch (#450). A tap fires pointerenter then, once the
  // finger lifts, pointerleave, so the plain hover wiring showed the
  // tooltip only while the finger was down, underneath it. A touch or pen
  // pointerenter instead *pins* the tooltip: pointerleave leaves it up,
  // and it clears on the next tap anywhere else (the effect below) or when
  // the browser takes the gesture over as a scroll (pointercancel). A ref,
  // not state, because it's only read inside event handlers.
  const pinnedByTouch = useRef(false);
  const pinned = hovered !== null;
  useEffect(() => {
    if (!pinned) return;
    const dismiss = (event: PointerEvent) => {
      if (!pinnedByTouch.current) return;
      // A tap on another cell re-pins through that cell's own handler.
      if (event.target instanceof Element && event.target.classList.contains("hit")) return;
      pinnedByTouch.current = false;
      setHovered(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pinned]);

  const { cellSize, rowHeight, totalHeight } = layout;

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", totalHeight);

      years.forEach((yearGroup, yi) => {
        const yearStart = new Date(yearGroup.year, 0, 1);
        const yearEnd = new Date(yearGroup.year + 1, 0, 1);
        const origin = layout.orientation === "months" ? layout.yearOrigin(yi) : layout.gridOrigin(yi);
        const g = svg.append("g").attr("transform", `translate(${origin.x},${origin.y})`);

        // Where a day's cell goes, relative to `g`. Horizontal: one grid
        // per year, weeks across and weekdays down. Months: each month's own
        // Monday-first grid, weekdays across and that month's weeks down.
        const cellPosition: (date: Date) => { x: number; y: number } =
          layout.orientation === "months"
            ? (date) => {
                const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                const mo = layout.monthOrigin(date.getMonth());
                const row = Math.floor((date.getDate() - 1 + mondayIndex(monthStart)) / 7);
                return { x: mo.x + mondayIndex(date) * rowHeight, y: mo.y + row * rowHeight };
              }
            : (date) => ({
                x: d3.timeMonday.count(yearStart, date) * rowHeight,
                y: mondayIndex(date) * rowHeight,
              });

        if (layout.orientation === "months") {
          g.append("text")
            .attr("y", 16)
            .attr("fill", "var(--foreground)")
            .style("font-size", "15px")
            .style("font-weight", 500)
            .text(String(yearGroup.year));

          // No weekday letters: repeated over twelve months they'd be
          // clutter, and a phone calendar's year view leaves them off too.
          // The tooltip names the weekday.
          for (const monthStart of d3.timeMonths(yearStart, yearEnd)) {
            const mo = layout.monthOrigin(monthStart.getMonth());
            g.append("text")
              .attr("x", mo.x)
              .attr("y", mo.y - 6)
              .attr("fill", "var(--muted-foreground)")
              .style("font-size", "13px")
              .text(monthStart.toLocaleDateString(undefined, { month: "short" }));
          }

          // Every day of the year gets a faint placeholder under its real
          // cell, so each month reads as a whole calendar even where the
          // data has gaps or ends partway through (the current year). The
          // horizontal layout doesn't need this: one continuous strip
          // already shows where it runs out, while a month with half its
          // days missing reads as a broken shape.
          g.selectAll(".blank")
            .data(d3.timeDays(yearStart, yearEnd))
            .join("rect")
            .attr("class", "blank")
            .attr("x", (d) => cellPosition(d).x)
            .attr("y", (d) => cellPosition(d).y)
            .attr("width", cellSize)
            .attr("height", cellSize)
            .attr("rx", 2)
            .attr("fill", "var(--muted)")
            .attr("fill-opacity", 0.5);
        } else {
          const monthTicks: MonthTick[] = d3.timeMonths(yearStart, yearEnd).map((monthStart) => ({
            label: monthStart.toLocaleDateString(undefined, { month: "short" }),
            week: d3.timeMonday.count(yearStart, monthStart),
          }));

          // Year number and day-of-week labels both live inside this same
          // translated `g`, so they move together with the grid as one
          // connected unit no matter where the layout centers it. The year
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
            .style("font-size", "15px")
            .style("font-weight", 500)
            .text(String(yearGroup.year));

          // Month labels along the top of the strip, aligned to the same
          // Monday-keyed week columns the day cells use below. Declutters
          // by simply dropping a label that would land too close to the
          // previously-placed one (narrow container -> narrow week columns
          // -> adjacent month labels would otherwise overlap).
          // Sized for the 13px labels (#449): a 3-letter month is ~24px wide
          // at that size, so the old 24px gap left them touching.
          const MIN_LABEL_GAP = 30;
          let lastLabelX = -Infinity;
          for (const tick of monthTicks) {
            const x = tick.week * rowHeight;
            if (x - lastLabelX < MIN_LABEL_GAP) continue;
            lastLabelX = x;
            g.append("text")
              .attr("x", x)
              .attr("y", -6)
              .attr("fill", "var(--muted-foreground)")
              .style("font-size", "13px")
              .text(tick.label);
          }

          g.selectAll(".daylabel")
            .data(DAY_LABELS)
            .join("text")
            .attr("class", "daylabel")
            .attr("x", -LEFT_LABEL_WIDTH + 2)
            .attr("y", (_, i) => i * rowHeight + cellSize - 1)
            .attr("fill", "var(--muted-foreground)")
            // 12px (up from 9, #449), but never taller than a row: at the
            // MIN_CELL_SIZE floor a row is only 10px, and a 12px letter
            // there would crowd into the next row's.
            .style("font-size", `${Math.min(12, rowHeight)}px`)
            .text((d) => d);
        }

        const cells: CellDatum[] = [...yearGroup.days.entries()].map(([dateStr, day]) => {
          const { x, y } = cellPosition(parseDate(dateStr));
          return { dateStr, value: day.value, categories: day.categories, x, y };
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
          .attr("x", (d) => d.x)
          .attr("y", (d) => d.y)
          .attr("width", cellSize)
          .attr("height", cellSize)
          .attr("rx", 2)
          .attr("fill", (d) => cellFill(d.value, d.categories));

        const hitSize = Math.max(cellSize, MARK_SPECS.hover.minHitTarget);
        const hitTargets = g
          .selectAll(".hit")
          .data(cells)
          .join("rect")
          .attr("class", "hit")
          .attr("x", (d) => d.x + cellSize / 2 - hitSize / 2)
          .attr("y", (d) => d.y + cellSize / 2 - hitSize / 2)
          .attr("width", hitSize)
          .attr("height", hitSize)
          .attr("fill", "transparent");

        attachMarkHover<CellDatum>(hitTargets, {
          onHover: (d, clientPos) =>
            setHovered({ dateStr: d.dateStr, value: d.value, categories: d.categories, clientPos }),
          // A touch-pinned tooltip outlives the finger lifting — see
          // `pinnedByTouch`.
          onLeave: () => {
            if (!pinnedByTouch.current) setHovered(null);
          },
        });
        // Namespaced so they sit alongside attachMarkHover's own
        // pointerenter/pointerleave rather than replacing them.
        hitTargets
          .on("pointerenter.pin", (event: PointerEvent) => {
            pinnedByTouch.current = event.pointerType !== "mouse";
          })
          .on("pointercancel.pin", () => {
            pinnedByTouch.current = false;
            setHovered(null);
          });
      });
    },
    [years, width, layout, cellSize, rowHeight, totalHeight, cellFill],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredColor = hovered ? cellFill(hovered.value, hovered.categories) : undefined;

  // Where the hovered cell's value falls on the low->high legend, as a
  // 0-1 fraction — drives the hover indicator line below.
  const legendT = hovered !== null ? valueToT(hovered.value) : null;

  return (
    // overflow-x-auto is only a last-resort safety net now. Any width too
    // narrow for the horizontal grid gets the month grid (#450), which fits
    // down to ResponsiveChart's 240px minimum.
    // Horizontal scrolling on mobile was the original fallback, but it
    // stopped around August because ChartCard clips its overflow.
    <div style={{ width }} className="overflow-x-auto">
      <div ref={setContainerEl} style={{ position: "relative", width }} role="img" aria-label={ariaLabel}>
        <svg ref={ref} />
        {hovered && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={formatDate(hovered.dateStr, "weekdayYear")}
            rows={[
              { label: valueLabel, value: formatValue(hovered.value), color: hoveredColor ?? "" },
              // The breakdown is what makes a blended cell readable: its
              // mixed color deliberately matches no legend entry, so the
              // categories behind it have to be nameable on hover.
              ...(hovered.categories ?? []).map((c) => ({
                label: c.label,
                value: c.value ?? "",
                color: c.color,
              })),
            ]}
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
          and sized by the layout. Horizontally that lines it up with the
          *grid* (where the cells are), not the wider outer box that
          also holds the day-label column and any centering margin.
          In months mode it spans the whole month grid. Gated on `containerRect` so it doesn't flash at (0,0)
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
      {/* Suppressed in blend mode: a low->high ramp describes an encoding
          the cells are no longer using, and a legend that confidently
          explains the wrong thing is worse than none. The categories are
          named per-day in the tooltip instead, and a blended calendar's
          caller is expected to render its own category key alongside the
          chart. */}
      {containerRect && !blended ? (
        <SequentialLegend
          domain={domain}
          colorScale={colorScale}
          sampleDomain={domain}
          formatValue={formatValue}
          valueT={legendT}
          ticks={legendTicks}
          tickUnit={legendTickUnit}
          className="fixed bottom-0 z-10 border-t border-border bg-background/95 px-3 py-2 backdrop-blur"
          // Width is clamped to the container's visible width (see
          // `calendarLayout`'s `legendWidth`): `position: fixed` escapes
          // the grid's own `overflow-x-auto`, so an unclamped legend used
          // to spill past a phone's right edge.
          style={{ left: containerRect.left + layout.legendLeft, width: layout.legendWidth }}
        />
      ) : null}
    </div>
  );
}
