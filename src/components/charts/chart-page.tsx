import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

// Shared page shell for every /charts/* page (user feedback on PR #40's
// preview: charts should use as much of the desktop viewport as
// possible, and there should be a persistent side console for future
// filter/sort/tool controls — "like legacy"). Before this, all 8 chart
// pages hand-rolled the identical
// `mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-{2xl..5xl}
// md:gap-6 md:py-12` wrapper + header row, differing only in which max-w
// step they capped out at (max-w-2xl through max-w-5xl, no principled
// reason for which page got which) — real duplication, and the thing
// actually capping chart width, per ChartCard itself (`w-full`, no cap of
// its own). This replaces all of that with one wide, uncapped container
// (padding only) plus a two-column layout on desktop.
//
// Note: the dataviz skill's own interaction.md recommends filters as a
// single row *above* the charts, not a sidebar — but this was an explicit,
// specific ask ("like legacy... side console"), and "sort or other kinds
// of tools" is broader than the date-range filters that guidance is about,
// so this builds what was asked for rather than the skill's default.

export function ChartPage({
  title,
  backHref = "/charts",
  backLabel = "Charts",
  sidebar,
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  /** Filter/sort/tool console for this chart. Omit for the default empty-
   * state skeleton below — a labeled placeholder future issues build real
   * controls into — or pass `null` to hide the console entirely for a
   * chart that genuinely has nothing to filter. */
  sidebar?: React.ReactNode;
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
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">{children}</div>
        {sidebar === null ? null : (
          <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-72">
            {sidebar ?? <ChartConsolePlaceholder />}
          </aside>
        )}
      </div>
    </main>
  );
}

/** Default side-console content: an honest empty state, not fake disabled
 * controls — this is scaffolding for future filter/sort/tool work (see
 * #14's epic plan), not a finished feature. A page with real controls
 * passes its own `sidebar` to `<ChartPage>` instead of this. */
function ChartConsolePlaceholder() {
  return (
    <Card size="sm" className="border-dashed shadow-none ring-foreground/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <SlidersHorizontal aria-hidden className="size-4" />
          Filters &amp; tools
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
