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
  ariaLabel?: string;
};

export function InteractiveRanked({
  entries,
  formatValue = formatThousandsNumber,
  exactValue = formatThousandsNumber,
  color = categoricalColor(0),
  ariaLabel = "Ranked list",
}: InteractiveRankedProps) {
  const max = Math.max(1, ...entries.map((e) => e.value));
  const resolveColor = (entry: RankedEntry, index: number) => (typeof color === "function" ? color(entry, index) : color);

  return (
    <ol className="space-y-2" aria-label={ariaLabel}>
      {entries.map((entry, i) => (
        <li key={entry.label} className="flex items-center gap-3">
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
