"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatThousandsNumber } from "@/lib/viz/format";
import { contrastingTextColor, divergingScale, sequentialLogScale, sequentialScale } from "@/lib/viz/color";
import type { RankMovement } from "@/lib/ranking";

// InteractiveRanked — the shared leaderboard primitive.
//
// **History.** #22 shipped this as a list of proportional bars (rank,
// label, bar, number), and #211 bolted a table mode onto that for the
// people table. #115 replaced both with one thing: a sports-style league
// table. A bar per row read as a bar chart, which is the wrong frame for
// "who's top, and who's climbing" — a standings table is what people
// already know how to read for that, and it holds several metrics side by
// side where a bar holds one.
//
// **Shape.** Generic over the row type, and knows nothing about places or
// people. A consumer passes rows already in rank order and declares its
// columns; each column *kind* brings its own formatting feature:
//
//  - `text`     — a label, optionally cell-coloured by a per-row colour
//                 (a place's path in its country's colour, a person's tag)
//  - `number`   — a metric, optionally conditionally formatted by value
//                 (a colour scale or an in-cell data bar)
//  - `movement` — a rank change over a window, green ▲ / red ▼ + places
//  - `custom`   — anything else, as a ReactNode
//
// The rank column is built in and always first; the first declared column
// is the row's name and is pinned beside it, so both stay put when a wide
// table scrolls sideways on a phone.
//
// **Still plain HTML, not SVG/D3.** Same call #22 made: a table is text in
// cells, and the browser already does layout, truncation, selection,
// keyboard focus and screen-reader semantics for `<table>` better than
// anything rebuilt in an SVG.
//
// Bar-race mode is a separate primitive (`InteractiveBarRace`, #103) — see
// that file's header for why. The two share nothing now that this one has
// no bars.

type Breakpoint = "sm" | "md" | "lg";

// Written out in full so Tailwind's scanner sees each class — a template
// string built from the breakpoint name would never be generated.
const HIDE_BELOW: Record<Breakpoint, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

type ColumnBase = {
  id: string;
  header: string;
  /** Header tooltip — what the column measures, when the header alone
   * doesn't say (e.g. that mentions are slot-weighted). */
  description?: string;
  /** Dropped below this breakpoint. Declare what a phone can lose; the
   * rank and name columns never hide. */
  hideBelow?: Breakpoint;
  /** Header click-to-sort. Defaults to on for text, number and movement
   * columns, and to on for a custom column only when it has `sortValue`. */
  sortable?: boolean;
};

/**
 * How a text column paints its cells from a per-row colour.
 *
 * - `tint` (default) — a translucent wash plus a solid left edge, like a
 *   team's colour stripe in a standings table. The text stays in normal
 *   ink, so it's readable on any colour the user picked, including ones
 *   only the browser can resolve (`var(--chart-N)`).
 * - `fill` — solid background, with black or white text chosen per cell
 *   (`contrastingTextColor`). Louder; needs a parseable colour (hex/rgb)
 *   to pick the text colour, and falls back to white text otherwise.
 */
export type CellColorStyle = "tint" | "fill";

export type RankedTextColumn<T> = ColumnBase & {
  kind: "text";
  value: (row: T) => string | null;
  /** A muted second line under the value. */
  detail?: (row: T) => string | null;
  cellColor?: {
    color: (row: T) => string | null;
    style?: CellColorStyle;
  };
};

/**
 * Conditional formatting for a number column — the value-driven half of
 * spreadsheet conditional formatting, which is what #115 asked for.
 *
 * - `scale` — shades a chip behind the number along the app's one-hue
 *   sequential ramp (`sequentialScale`). `log: true` spreads a heavy-tailed
 *   metric out — place mentions are dominated by home, which on a linear
 *   ramp would leave every other row the same pale step.
 * - `diverging` — for a value with a meaningful midpoint (an impact score
 *   that can go negative). Midpoint defaults to 0.
 * - `bar` — an in-cell data bar behind the number. Kept as an option for
 *   metrics where proportion matters more than rank, not as a default:
 *   a bar per row is exactly what #115 moved away from.
 *
 * The domain defaults to the extent of the rows passed in, so it rescales
 * when a "show top N" control changes which rows those are — the shading
 * describes the table on screen, not rows the reader can't see.
 */
export type ConditionalFormat =
  | { type: "scale"; log?: boolean; domain?: [number, number] }
  | { type: "diverging"; domain?: [number, number, number] }
  | { type: "bar"; color?: string };

export type RankedNumberColumn<T> = ColumnBase & {
  kind: "number";
  value: (row: T) => number | null;
  /** Displayed value. Defaults to `formatThousandsNumber`. */
  format?: (value: number) => string;
  /** Hover value — defaults to `formatThousandsNumber`, so a compact
   * `format` ("1.2k") still has the exact number on demand. */
  exact?: (value: number) => string;
  conditional?: ConditionalFormat;
};

export type RankedMovementColumn<T> = ColumnBase & {
  kind: "movement";
  movement: (row: T) => RankMovement | null;
  /** Amount gained inside the window (e.g. +12 mentions this month), shown
   * muted beside the arrow — the "how much" behind the "how far". */
  gained?: (row: T) => number | null;
  formatGained?: (value: number) => string;
  /** How the window reads in a sentence, for the hover label: "Up 3 places
   * since a week ago". */
  since: string;
};

export type RankedCustomColumn<T> = ColumnBase & {
  kind: "custom";
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => number | string | null;
  align?: "left" | "right";
};

export type RankedColumn<T> =
  | RankedTextColumn<T>
  | RankedNumberColumn<T>
  | RankedMovementColumn<T>
  | RankedCustomColumn<T>;

export type InteractiveRankedProps<T> = {
  /** Rows in rank order, best first. */
  rows: T[];
  getKey: (row: T) => string;
  /** The row's rank. Defaults to its position; pass the real rank when ties
   * share one (`RankedItem.rank`), so two rows level on 10 both read 1st. */
  rank?: (row: T, index: number) => number;
  /** The first column is the row's name: pinned, left-aligned, never hidden. */
  columns: RankedColumn<T>[];
  ariaLabel: string;
};

type SortState = { columnId: string; direction: "asc" | "desc" } | null;

/** "1st", "2nd", "11th", "23rd". */
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function isSortable<T>(column: RankedColumn<T>): boolean {
  if (column.sortable !== undefined) return column.sortable;
  return column.kind !== "custom" || column.sortValue !== undefined;
}

/** First click on a header: numbers and movement read best biggest-first,
 * text reads best A→Z. */
function defaultDirection<T>(column: RankedColumn<T>): "asc" | "desc" {
  return column.kind === "text" ? "asc" : "desc";
}

function sortValueOf<T>(column: RankedColumn<T>, row: T): number | string | null {
  switch (column.kind) {
    case "text":
      return column.value(row)?.toLocaleLowerCase() ?? null;
    case "number":
      return column.value(row);
    case "movement": {
      // A new entry has no delta to compare, so it sorts with the blanks
      // rather than being pretended into a number — "new" is not a big
      // climb, it's the absence of a starting point.
      const movement = column.movement(row);
      return movement && !movement.isNew ? movement.delta : null;
    }
    case "custom":
      return column.sortValue?.(row) ?? null;
  }
}

/** Header cell alignment follows the column's content. */
function alignOf<T>(column: RankedColumn<T>, isName: boolean): "left" | "right" {
  if (isName) return "left";
  if (column.kind === "text") return "left";
  if (column.kind === "custom") return column.align ?? "left";
  return "right";
}

/** A per-column value→colour function for conditional formatting, built
 * once per render from the rows on screen. */
function buildConditionalColor<T>(
  column: RankedNumberColumn<T>,
  rows: T[],
): ((value: number) => string) | null {
  const format = column.conditional;
  if (!format || format.type === "bar") return null;
  const values = rows.map(column.value).filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);

  // "dark" throughout: this app renders in its dark theme only (see
  // `dark` on <html> in layout.tsx), and these ramps are TS constants
  // rather than theme-flipping CSS tokens — same call technology-charts
  // makes for its calendar ramp.
  if (format.type === "diverging") {
    const [lo, mid, hi] = format.domain ?? [min, 0, max];
    // A one-sided domain (every value above the midpoint) would squash
    // into half the ramp; mirroring the far side keeps 0 at the midpoint.
    const reach = Math.max(Math.abs(lo - mid), Math.abs(hi - mid)) || 1;
    const scale = divergingScale([mid - reach, mid, mid + reach], "dark");
    return (v) => scale(v);
  }
  if (format.log) {
    const positive = values.filter((v) => v > 0);
    const [lo, hi] = format.domain ?? (positive.length > 0 ? [Math.min(...positive), Math.max(...positive)] : [1, 1]);
    // Log has no zero; clamp so a zero row still gets the ramp's low end.
    const scale = sequentialLogScale([lo, Math.max(hi, lo * 1.0001)], "dark").clamp(true);
    return (v) => scale(Math.max(v, lo));
  }
  const [lo, hi] = format.domain ?? [min, max];
  const scale = sequentialScale([lo, hi === lo ? lo + 1 : hi], "dark").clamp(true);
  return (v) => scale(v);
}

/** Bar width for a `bar` conditional format — measured from zero rather
 * than from the smallest row, so a bar's length is the value's real
 * proportion of the leader's. */
function buildBarWidth<T>(column: RankedNumberColumn<T>, rows: T[]): ((value: number) => number) | null {
  if (column.conditional?.type !== "bar") return null;
  const max = Math.max(0, ...rows.map(column.value).filter((v): v is number => v !== null));
  return (v) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
}

function Blank() {
  return <span className="text-muted-foreground/60">—</span>;
}

/**
 * A rank change, drawn the same way everywhere it appears.
 *
 * Green up / red down per #115 — #211 carried direction in glyphs alone
 * because the app had no status colours; `--rank-up`/`--rank-down`
 * (globals.css) are now that pair, validated for red-green colour
 * blindness. The ▲/▼ glyph and the accessible label stay regardless, so
 * colour is never the only thing saying which way a row moved.
 *
 * Exported for any surface that wants a single movement cell outside a
 * full table (a recap card, a tooltip).
 */
export function RankMovementCell({
  movement,
  currentRank,
  since,
}: {
  movement: RankMovement | null;
  currentRank: number;
  since: string;
}) {
  if (!movement) return <Blank />;
  if (movement.isNew) {
    return (
      <span
        className="rounded-sm bg-accent px-1.5 py-px text-[10px] font-semibold tracking-wide text-accent-foreground uppercase"
        title={`New since ${since} — not ranked then, ${ordinal(currentRank)} now`}
      >
        New
      </span>
    );
  }
  const delta = movement.delta ?? 0;
  if (delta === 0) {
    return (
      <span className="text-muted-foreground/70" title={`No change since ${since} — still ${ordinal(currentRank)}`}>
        –
      </span>
    );
  }
  const up = delta > 0;
  const places = Math.abs(delta);
  const label = `${up ? "Up" : "Down"} ${places} ${places === 1 ? "place" : "places"} since ${since} — ${
    movement.previousRank !== null ? `${ordinal(movement.previousRank)} then, ` : ""
  }${ordinal(currentRank)} now`;
  return (
    <span
      className={`inline-flex items-baseline gap-0.5 font-medium tabular-nums ${up ? "text-rank-up" : "text-rank-down"}`}
      title={label}
      aria-label={label}
    >
      <span aria-hidden className="text-[0.7em]">
        {up ? "▲" : "▼"}
      </span>
      <span aria-hidden>{places}</span>
    </span>
  );
}

function tintStyle(color: string): CSSProperties {
  // color-mix rather than an rgba() built in JS, so a `var(--chart-N)`
  // colour works too — only the browser can resolve those. Painted as a
  // background *image* so it layers over whatever background colour the
  // cell already has: the row's hover colour shows through it, and a
  // pinned cell keeps its opaque card colour underneath instead of going
  // see-through over the columns scrolling past it.
  const wash = `color-mix(in oklab, ${color} 22%, transparent)`;
  return {
    backgroundImage: `linear-gradient(${wash}, ${wash})`,
    boxShadow: `inset 3px 0 0 ${color}`,
  };
}

function TextCell<T>({ column, row, isName }: { column: RankedTextColumn<T>; row: T; isName: boolean }) {
  const value = column.value(row);
  const detail = column.detail?.(row) ?? null;
  return (
    <div className="flex min-w-0 flex-col">
      {value ? (
        <span
          className={`truncate ${isName ? "max-w-[8.5rem] font-medium sm:max-w-[16rem]" : "max-w-[18rem]"}`}
          title={value}
        >
          {value}
        </span>
      ) : (
        <Blank />
      )}
      {detail ? <span className="truncate text-xs opacity-70">{detail}</span> : null}
    </div>
  );
}

function NumberCell<T>({
  column,
  row,
  colorFor,
  barWidth,
}: {
  column: RankedNumberColumn<T>;
  row: T;
  colorFor: ((value: number) => string) | null;
  barWidth: ((value: number) => number) | null;
}) {
  const value = column.value(row);
  if (value === null || !Number.isFinite(value)) return <Blank />;
  const format = column.format ?? formatThousandsNumber;
  const exact = (column.exact ?? formatThousandsNumber)(value);

  if (colorFor) {
    const fill = colorFor(value);
    return (
      <span
        className="inline-block min-w-[3.25rem] rounded-md px-2 py-0.5 text-right font-medium tabular-nums"
        style={{ backgroundColor: fill, color: contrastingTextColor(fill) }}
        title={exact}
      >
        {format(value)}
      </span>
    );
  }
  if (barWidth) {
    const barColor = column.conditional?.type === "bar" && column.conditional.color ? column.conditional.color : "var(--chart-1)";
    return (
      <span className="relative inline-flex w-24 justify-end px-1.5 py-0.5 tabular-nums" title={exact}>
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            width: `${barWidth(value) * 100}%`,
            backgroundColor: `color-mix(in oklab, ${barColor} 45%, transparent)`,
          }}
        />
        <span className="relative">{format(value)}</span>
      </span>
    );
  }
  return (
    <span className="tabular-nums" title={exact}>
      {format(value)}
    </span>
  );
}

function MovementCell<T>({
  column,
  row,
  currentRank,
}: {
  column: RankedMovementColumn<T>;
  row: T;
  currentRank: number;
}) {
  const gained = column.gained?.(row) ?? null;
  return (
    <span className="inline-flex items-baseline justify-end gap-2">
      {/* The gained figure is the first thing a phone loses: without it,
          rank, name, the main metric and one movement column fit a 375px
          screen with no sideways scroll. */}
      {column.gained ? (
        <span className="hidden min-w-8 text-right text-xs text-muted-foreground tabular-nums sm:inline">
          {gained !== null && gained !== 0 ? `+${(column.formatGained ?? formatThousandsNumber)(gained)}` : ""}
        </span>
      ) : null}
      <span className="inline-flex min-w-8 justify-end">
        <RankMovementCell movement={column.movement(row)} currentRank={currentRank} since={column.since} />
      </span>
    </span>
  );
}

export function InteractiveRanked<T>({ rows, getKey, rank, columns, ariaLabel }: InteractiveRankedProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  // Rank is fixed to each row before sorting: the rank column always shows
  // the real standing, the way a league table sorted by goals scored still
  // shows each team's league position.
  const ranked = useMemo(
    () => rows.map((row, index) => ({ row, rank: rank ? rank(row, index) : index + 1, index })),
    [rows, rank],
  );

  const sorted = useMemo(() => {
    if (!sort) return ranked;
    const column = columns.find((c) => c.id === sort.columnId);
    if (!column) return ranked;
    const sign = sort.direction === "asc" ? 1 : -1;
    return [...ranked].sort((a, b) => {
      const av = sortValueOf(column, a.row);
      const bv = sortValueOf(column, b.row);
      // Blanks last in either direction — flipping the sort shouldn't
      // flood the top of the table with empty cells.
      if (av === null && bv === null) return a.index - b.index;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    });
  }, [ranked, columns, sort]);

  const formatters = useMemo(
    () =>
      new Map(
        columns.map((column) => [
          column.id,
          column.kind === "number"
            ? { colorFor: buildConditionalColor(column, rows), barWidth: buildBarWidth(column, rows) }
            : { colorFor: null, barWidth: null },
        ]),
      ),
    [columns, rows],
  );

  /** Header click cycles: default direction → reversed → back to rank. */
  const onSort = (column: RankedColumn<T>) => {
    setSort((current) => {
      if (!current || current.columnId !== column.id) {
        return { columnId: column.id, direction: defaultDirection(column) };
      }
      if (current.direction === defaultDirection(column)) {
        return { columnId: column.id, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      return null;
    });
  };

  const ariaSort = (id: string): "ascending" | "descending" | "none" =>
    sort?.columnId === id ? (sort.direction === "asc" ? "ascending" : "descending") : "none";

  // Pinned cells need an opaque background of their own, or scrolled cells
  // show through them; it tracks the row's hover state via `group`.
  const pinnedCell = "sticky z-10 bg-card transition-colors group-hover:bg-accent";
  const pinnedHeader = "sticky z-10 bg-card";

  return (
    // overflow-x-auto rather than shrinking columns past legibility — the
    // pinned rank/name columns keep each row identifiable while it scrolls.
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-separate border-spacing-0 text-left text-sm" aria-label={ariaLabel}>
        <thead>
          <tr className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            <th
              scope="col"
              className={`${pinnedHeader} left-0 w-10 min-w-10 border-b border-border py-2 pr-2 text-center`}
              aria-sort={sort ? "none" : "ascending"}
            >
              {sort ? (
                <button
                  type="button"
                  className="rounded-sm hover:text-foreground focus-visible:outline-2"
                  onClick={() => setSort(null)}
                  title="Back to rank order"
                >
                  #
                </button>
              ) : (
                "#"
              )}
            </th>
            {columns.map((column, i) => {
              const isName = i === 0;
              const align = alignOf(column, isName);
              const active = sort?.columnId === column.id;
              const content = (
                <>
                  {column.header}
                  <span aria-hidden className={`text-[0.9em] ${active ? "opacity-100" : "opacity-0"}`}>
                    {active && sort?.direction === "asc" ? "↑" : "↓"}
                  </span>
                </>
              );
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={isSortable(column) ? ariaSort(column.id) : undefined}
                  className={`border-b border-border py-2 pr-3 font-semibold whitespace-nowrap ${
                    align === "right" ? "text-right" : "text-left"
                  } ${isName ? `${pinnedHeader} left-10` : column.hideBelow ? HIDE_BELOW[column.hideBelow] : ""} ${
                    active ? "text-foreground" : ""
                  }`}
                  title={column.description}
                >
                  {isSortable(column) ? (
                    <button
                      type="button"
                      onClick={() => onSort(column)}
                      className={`inline-flex items-center gap-1 rounded-sm uppercase hover:text-foreground focus-visible:outline-2 ${
                        align === "right" ? "flex-row-reverse" : ""
                      }`}
                    >
                      {content}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row, rank: rowRank, index }) => (
            <tr key={getKey(row)} className="group transition-colors hover:bg-accent">
              <td className={`${pinnedCell} left-0 border-b border-border/40 py-1.5 pr-2 text-center`}>
                {/* Podium ranks get a filled badge — the standings-table
                    cue that makes the top of a long table findable at a
                    glance, without spending a colour on it. */}
                <span
                  className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs tabular-nums ${
                    rowRank <= 3 ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {rowRank}
                </span>
              </td>
              {columns.map((column, i) => {
                const isName = i === 0;
                const align = alignOf(column, isName);
                const tint =
                  column.kind === "text" && column.cellColor ? column.cellColor.color(row) : null;
                const tintMode = column.kind === "text" ? (column.cellColor?.style ?? "tint") : "tint";
                const style: CSSProperties | undefined = tint
                  ? tintMode === "fill"
                    ? { backgroundColor: tint, color: contrastingTextColor(tint) }
                    : tintStyle(tint)
                  : undefined;
                const { colorFor, barWidth } = formatters.get(column.id) ?? { colorFor: null, barWidth: null };
                return (
                  <td
                    key={column.id}
                    style={style}
                    className={`border-b border-border/40 py-1.5 ${tint ? "px-2.5" : "pr-3"} ${
                      align === "right" ? "text-right" : "text-left"
                    } ${isName ? `${pinnedCell} left-10` : column.hideBelow ? HIDE_BELOW[column.hideBelow] : ""}`}
                  >
                    {column.kind === "text" ? (
                      <TextCell column={column} row={row} isName={isName} />
                    ) : column.kind === "number" ? (
                      <NumberCell column={column} row={row} colorFor={colorFor} barWidth={barWidth} />
                    ) : column.kind === "movement" ? (
                      <MovementCell column={column} row={row} currentRank={rowRank} />
                    ) : (
                      column.render(row, index)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
