import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";

// Shared page shell for every /charts/* page (user feedback on PR #40's
// preview: charts should use as much of the desktop viewport as
// possible, and there should be a place for future filter/sort/tool
// controls). Before this, all 8 chart pages hand-rolled the identical
// `mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-{2xl..5xl}
// md:gap-6 md:py-12` wrapper + header row, differing only in which max-w
// step they capped out at (max-w-2xl through max-w-5xl, no principled
// reason for which page got which) — real duplication, and the thing
// actually capping chart width, since ChartCard itself is `w-full` with
// no cap of its own. This replaces all of that with one wide, uncapped
// container (padding only) plus a filters row above the chart.
//
// The filters row (not a sidebar) follows the dataviz skill's own
// interaction.md: "One row, above the charts. Filters sit in a single
// left-aligned row above the content they scope — never inside a chart
// card, never per-chart." An earlier version of this shell used a side
// console instead (a specific, explicit ask at the time); revisited and
// switched to match the skill's guidance once the tradeoff was flagged.

export function ChartPage({
  title,
  backHref = "/charts",
  backLabel = "Charts",
  filters,
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  /** Filter/sort/tool row for this chart — a single left-aligned row
   * rendered above the chart content. Omit for the default empty-state
   * skeleton below (a labeled placeholder future issues build real
   * controls into), or pass `null` to omit the row entirely for a chart
   * that genuinely has nothing to filter. */
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 py-8 md:gap-6 md:px-8 md:py-12 lg:px-10">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">{title}</h1>
        <Link href={backHref} className="text-xs text-muted-foreground hover:text-foreground">
          {backLabel}
        </Link>
      </div>
      {filters === null ? null : (
        <div className="flex flex-wrap items-center gap-2">{filters ?? <ChartFiltersPlaceholder />}</div>
      )}
      {children}
    </main>
  );
}

/** Default filters-row content: an honest empty state, not fake disabled
 * controls — this is scaffolding for future filter/sort/tool work (see
 * #14's epic plan), not a finished feature. A page with real controls
 * passes its own `filters` to `<ChartPage>` instead of this. */
function ChartFiltersPlaceholder() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-foreground/15 px-3 py-1.5 text-sm text-muted-foreground">
      <SlidersHorizontal aria-hidden className="size-4" />
      Filters &amp; tools
    </div>
  );
}
