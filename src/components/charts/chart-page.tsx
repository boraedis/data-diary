import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { ChartInfo } from "@/components/charts/chart-info";

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
//
// #315: the title used to be rendered a second time inside `ChartCard`
// right below this one. `description` now lives here instead (the single
// short line under the title), and `info` renders the standardized
// `ChartInfo` popup next to it — `ChartCard` itself is chrome-only now, no
// header of its own. Page padding is also tighter than the original pass
// above: with the duplicate header gone there's less to compress, but the
// remaining vertical padding was still more than the chart needs.
//
// #315 follow-up: `main` is `flex-1`, not just padded, so that the
// header/description/filters "chrome" above it and the chart card
// genuinely share one screen — the card fills whatever's left after that
// chrome, rather than the chrome being layered on top of an
// already-full-viewport card (which just pushed the page taller than one
// screen, with a scrollbar, for no reason).
//
// `flex-1` works here — rather than `main` needing to know the viewport
// height itself — because the root layout (`src/app/layout.tsx`) already
// sets up the standard sticky-footer flex recipe: `<html class="h-full">`
// / `<body class="min-h-full flex flex-col">`. `<TopNav>` (rendered above
// `{children}` in `src/app/(app)/layout.tsx`) and this `<main>` are direct
// flex-column children of that `<body>`, so `main` growing via `flex-1`
// naturally fills exactly "the viewport minus TopNav" — accounting for
// TopNav's height for free, without this file hardcoding a pixel/rem
// guess at it. `min-height` (not a fixed `height`) on `body` is what makes
// this safe for taller-than-one-screen content too: a page whose content
// (this one included) needs more than one screen just grows `body` past
// `min-h-full`, scrolling normally, rather than anything being clipped.
//
// Within `main` itself: the header and filters rows are `shrink-0` so a
// long title or a wrapped filters row is never squeezed to make room;
// only the `{children}` wrapper is allowed to shrink (`min-h-0`), and it
// degrades gracefully when it does — a canvas-style chart's own
// `min-h-[320px]` floor (`CHART_HEIGHT_CLASS`, responsive-chart.tsx)
// simply overflows a little on a very short screen with a lot of chrome
// above it, rather than the chart being crushed unreadable. The recap
// report, which reuses this same shell for several stacked sections
// rather than one chart, relies on exactly this: its sections' combined
// natural height is normally well over one screen, so this wrapper (and
// `main`, and `body`) all grow to fit them, and the page scrolls normally
// — nothing here ever sets `overflow: hidden`.

export function ChartPage({
  title,
  backHref = "/charts",
  backLabel = "Charts",
  description,
  info,
  filters,
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  /** Short, one-line description shown under the title — what #315 pulled
   * out of `ChartCard`'s now-removed header. */
  description?: string;
  /** Content for the `ChartInfo` details popup. Required on every real
   * chart page per #315's scope ("every chart should come with an
   * interaction guide") — omit only for a page with no chart to explain
   * (e.g. the recap report, which reuses this shell for its own layout). */
  info?: { interactionGuide: string; methodology?: string };
  /** Filter/sort/tool row for this chart — a single left-aligned row
   * rendered above the chart content. Omit for the default empty-state
   * skeleton below (a labeled placeholder future issues build real
   * controls into), or pass `null` to omit the row entirely for a chart
   * that genuinely has nothing to filter. */
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // px-2 below sm, not px-4: on a phone every pixel of width is chart,
    // and 16px of gutter either side is ~9% of a 375px screen spent on
    // nothing. Still enough to keep the card reading as a card rather than
    // a full-bleed band. Vertical padding trimmed further under #315 now
    // that the header below is a single line, not a title + a duplicate
    // card header.
    <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-2 py-4 sm:px-4 md:gap-6 md:px-8 md:py-6 lg:px-10">
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <h1 className="font-heading text-2xl font-medium tracking-tight text-balance md:text-3xl">
              {title}
            </h1>
            {info ? (
              <ChartInfo
                title={title}
                interactionGuide={info.interactionGuide}
                methodology={info.methodology}
              />
            ) : null}
          </div>
          <Link
            href={backHref}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            {backLabel}
          </Link>
        </div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {filters === null ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {filters ?? <ChartFiltersPlaceholder />}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:gap-6">{children}</div>
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
