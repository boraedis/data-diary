"use client";

import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveTimeline } from "@/components/charts/interactive/interactive-timeline";
import { PROJECT_VERSIONS, projectVersionEnd } from "@/lib/project-versions";
import type { TimelineInterval } from "@/lib/viz/timeline";

// /about-project's version timeline (#454). One lane per version, not all
// four bars in a single lane: the current version is a few weeks against a
// decade, too thin to hold an inline label, so the lane label down the left
// is what names it. It also gives each version its own categorical slot,
// and there are four versions for five slots.
//
// The page lists each version's dates and description below the chart
// too, so the chart doesn't have to be hovered to be read. That matters
// most on a phone, where the bars are thin.

// Module-level so the array InteractiveTimeline memoizes on stays stable.
const ITEMS: TimelineInterval[] = PROJECT_VERSIONS.map((version, i) => ({
  id: version.id,
  lane: version.name,
  // The tooltip prints full dates, so an approximate version says so
  // there. Otherwise its placeholder Jan 1 would read as a recorded date.
  label: version.approximateStart ? `${version.name} (start date approximate)` : version.name,
  start: version.start,
  end: projectVersionEnd(i),
}));

/** Four rows at the primitive's max row height, plus axis margins. The
 * chart is content-sized and centers itself in whatever height it's given
 * (see InteractiveTimeline's sizing notes), so anything taller is padding. */
const HEIGHT = 300;

export function ProjectVersionTimeline() {
  return (
    <ResponsiveChart height={HEIGHT}>
      {({ width, height }) => (
        <InteractiveTimeline
          items={ITEMS}
          width={width}
          height={height}
          valueLabel="in use"
          ariaLabel="Timeline of the project's versions, one row each, from the 2016 Numbers file to the current Next.js rebuild. Scroll or pinch to zoom the time axis, drag to pan. Hover or focus a bar for its dates."
        />
      )}
    </ResponsiveChart>
  );
}
