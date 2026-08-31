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
 */
export function Legend({ series, className }: { series: LegendSeries[]; className?: string }) {
  if (series.length < 2) return null;

  return (
    <div role="list" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {series.map((s) => (
        <div key={s.label} role="listitem" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SeriesKey color={s.color} variant="swatch" />
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
