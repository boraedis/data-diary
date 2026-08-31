import { cn } from "@/lib/utils";

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
