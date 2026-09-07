import { formatThousandsNumber } from "@/lib/viz/format";
import { categoricalColor } from "@/lib/viz/color";

// InteractiveRanked (#22) — the shared ranked-list primitive. Generalizes
// PlaceLeaderboard's row shape (rank, label, value, proportional bar) into
// a reusable component over any `{label, value}[]`. Deliberately plain
// HTML/CSS, not SVG/D3 — matches PlaceLeaderboard's own original decision
// (a bar-width-by-percentage row is simpler and more accessible than an
// SVG bar chart for "just show me a ranking"), and the toolkit's `marks.ts`
// bar helpers (roundedBarPath etc.) are SVG path builders that don't apply
// to a CSS width percentage anyway.
//
// Bar-race mode (this issue's stretch goal — legacy's setInterval-driven
// BarRace, redone with real play/pause/scrub controls) is split out to
// #103 rather than shipped here, per #22's own acceptance criteria ("don't
// let it block shipping ranked-list mode... don't ship an uncontrolled
// auto-play regression"): it's a genuinely separate feature (time-stepped
// animation/reordering), not an incremental extension of this static list.

export type RankedEntry = { label: string; value: number };

/**
 * An extra column in table mode.
 *
 * Passing any turns the ranked list into a real table with a header row.
 * The list form stays the default because most consumers only want
 * "label, bar, number" — the places leaderboard has no use for columns and
 * shouldn't grow a header to say so.
 */
export type RankedColumn = {
  id: string;
  label: string;
  render: (entry: RankedEntry, index: number) => React.ReactNode;
  /** Dropped below the `sm` breakpoint. Three movement columns plus a
   * name and a count is more than a phone can hold, and the week is the
   * one worth keeping when something has to go. */
  secondary?: boolean;
};

export type InteractiveRankedProps = {
  entries: RankedEntry[];
  /** Formats each row's displayed value — defaults to
   * `formatThousandsNumber` (full precision, e.g. "1,234"). Pass
   * `formatCompactNumber` for a large-magnitude metric where "1.2k" reads
   * better than the full number; the row's `title` attribute always shows
   * the full-precision number regardless (see `exactValue` below), so
   * nothing is lost to abbreviation, just hidden until hovered/focused. */
  formatValue?: (value: number) => string;
  /** Formats the value shown in each row's `title` tooltip (native
   * browser tooltip, on hover or keyboard focus) — defaults to
   * `formatThousandsNumber` regardless of `formatValue`, so a caller using
   * a compact `formatValue` still gets the exact number on demand. */
  exactValue?: (value: number) => string;
  /** Bar fill — a single color (defaults to `categoricalColor(0)`) or a
   * function keying color off each entry (e.g. a per-category color),
   * mirroring InteractiveNetwork's own `color` prop shape. */
  color?: string | ((entry: RankedEntry, index: number) => string);
  /** Supporting line under the label — a tag, a category. Kept separate
   * from `columns` because it belongs *with* the name rather than in its
   * own cell, and it survives on narrow screens where columns don't. */
  detail?: (entry: RankedEntry, index: number) => string | null;
  /** Extra columns. Presence of this switches the primitive into table
   * mode; see `RankedColumn`. */
  columns?: RankedColumn[];
  /** Header above the value column in table mode. */
  valueLabel?: string;
  ariaLabel?: string;
};

/**
 * A rank change, drawn the same way everywhere it appears.
 *
 * Direction is carried by the glyph and the accessible label, never by
 * colour alone — this app has no validated status palette (`--chart-1..5`
 * are the fixed categorical slots, `--destructive` means error), and the
 * recap epic hit the same wall twice before settling on words and shapes.
 */
export function RankMovementCell({ delta, isNew }: { delta: number | null; isNew: boolean }) {
  if (isNew) {
    return (
      <span className="text-xs text-muted-foreground" title="New this period">
        new
      </span>
    );
  }
  if (delta === null) {
    return (
      <span className="text-xs text-muted-foreground" title="Not present this period">
        —
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="text-xs text-muted-foreground" title="Unchanged">
        ·
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className="text-xs text-muted-foreground tabular-nums"
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? "place" : "places"}`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span> {Math.abs(delta)}
    </span>
  );
}

export function InteractiveRanked({
  entries,
  formatValue = formatThousandsNumber,
  exactValue = formatThousandsNumber,
  color = categoricalColor(0),
  detail,
  columns,
  valueLabel = "Days",
  ariaLabel = "Ranked list",
}: InteractiveRankedProps) {
  const max = Math.max(1, ...entries.map((e) => e.value));
  const resolveColor = (entry: RankedEntry, index: number) => (typeof color === "function" ? color(entry, index) : color);

  if (columns && columns.length > 0) {
    return (
      // overflow-x-auto rather than shrinking columns past legibility —
      // same tradeoff the calendar makes on a narrow viewport.
      <div className="overflow-x-auto">
        <table className="w-full text-left" aria-label={ariaLabel}>
          <thead>
            <tr className="border-b border-border/60 text-xs text-muted-foreground">
              <th scope="col" className="w-8 py-1.5 pr-2 text-right font-medium">
                #
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Name
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium tabular-nums">
                {valueLabel}
              </th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`py-1.5 pr-3 text-right font-medium ${column.secondary ? "hidden sm:table-cell" : ""}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={entry.label} className="border-b border-border/40 last:border-0 hover:bg-accent">
                <td className="py-1.5 pr-2 text-right text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="py-1.5 pr-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="truncate text-sm" title={entry.label}>
                      {entry.label}
                    </span>
                    {detail?.(entry, i) ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {detail(entry, i)}
                      </span>
                    ) : null}
                    {/* The bar survives into table mode: a column of
                        numbers is precise but slow to scan, and the bar is
                        what makes the shape of a ranking readable at a
                        glance. */}
                    <div className="mt-0.5 h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(entry.value / max) * 100}%`,
                          backgroundColor: resolveColor(entry, i),
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td
                  className="py-1.5 pr-3 text-right text-sm tabular-nums"
                  title={exactValue(entry.value)}
                >
                  {formatValue(entry.value)}
                </td>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`py-1.5 pr-3 text-right ${column.secondary ? "hidden sm:table-cell" : ""}`}
                  >
                    {column.render(entry, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    // No space-y here — each row's own py-1 (below) provides the gap now
    // that rows carry hover padding, so stacking them with zero extra gap
    // keeps the same ~8px rhythm the old space-y-2 gave a padding-less row.
    <ol aria-label={ariaLabel}>
      {entries.map((entry, i) => (
        <li
          key={entry.label}
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-accent"
        >
          <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              {/* title: native tooltip carries the full label when the
                  truncate class clips it, and doubles as the "exact value
                  on hover" affordance the primitive's own scope calls for —
                  no bespoke tooltip component needed for a plain HTML row. */}
              <span className="truncate text-sm" title={entry.label}>
                {entry.label}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={exactValue(entry.value)}>
                {formatValue(entry.value)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(entry.value / max) * 100}%`,
                  backgroundColor: resolveColor(entry, i),
                }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
