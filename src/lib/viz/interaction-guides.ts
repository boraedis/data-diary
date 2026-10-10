/**
 * Generic, primitive-level interaction-guide copy for the `ChartInfo`
 * details popup (#315). Interaction mechanics are a property of the
 * *primitive* a chart is built on, not of the individual chart — every
 * `InteractiveLine` chart supports the same hover/zoom regardless of what
 * it plots — so this is one paragraph per primitive, reused across every
 * chart built on it, rather than copy repeated (and drifting) per page.
 *
 * Per-chart wording (what a chart actually shows, how a value is derived)
 * is separate — see `PLACEHOLDER_METHODOLOGY` below and #316, the content
 * follow-up ticket that replaces these placeholders with real per-chart
 * copy once the popup itself is live.
 */

export const LINE_INTERACTION_GUIDE =
  "Hover a point for its exact value and date. With more than one line, click a legend entry to hide or show that line; while two to six lines are showing, each is also named at its right end. When the points are spread out enough (yearly buckets, or a short range), each one's value is written beside it, leaving out any that would collide with a line, a marker or another label. Drag across the chart to narrow the time range to that stretch, the same as moving the range picker (not on the Day of Week, Month of Year or Day of Year folds); double-click to show everything again. The shaded band is ±1 standard deviation around that period's plotted average, drawn only while a single line is visible; marker size shows how many days fed the point. Where a dotted line is drawn, it marks a fixed target (8 hours, say), labelled at its right end. Where Bucket by offers Day of Week, Month of Year and Day of Year, those fold every year in the chosen range onto one Monday–Sunday, January–December or January 1–December 31 axis, averaging each point across all of them. Day of Year adds a Smoothing picker: None plots each calendar day's own average, while ±1, ±3 or ±7 days pools that many days either side of each date for a smoother curve.";

/** `InteractiveLine` with `hover="series"`, for charts carrying too many
 * lines for the crosshair's every-line readout (the People Impact Trend). */
export const LINE_SERIES_HOVER_INTERACTION_GUIDE =
  "Hover near a line to pick it out: it's drawn on top, the rest fade, and the readout gives that line's name, date and value. With the chart focused, the left and right arrow keys move through time and up and down move between lines.";

export const SCROLLER_INTERACTION_GUIDE =
  "Scroll or drag directly on the chart to zoom in, or drag the strip below it; double-click to reset. Hover or use the arrow keys to inspect an individual entry. Click a legend entry to hide or show that line or the rolling average. The chart opens by zooming in from the full history to the last three months; touch it and the animation stops. Where a dotted line is drawn, it marks a fixed target (8 hours, say), labelled at its right end.";

export const STRIP_INTERACTION_GUIDE =
  "Each row is one group: the dot is its average, the whiskers its 95% confidence interval, and n how many days it holds. A wide interval means too few days to trust the average yet. Hover a row, or focus the chart and use the up and down arrow keys, for its exact figures. Switch Show to Every day to draw each day behind the averages. The dotted line is the average across every day shown.";

export const HIST_INTERACTION_GUIDE =
  "Hover a bar, or focus the chart and tab through the buckets, for the exact count. The dashed line marks the average. Where there's a Split by picker, it divides the days in two and draws both distributions on the same buckets: Share compares their shapes as a percentage of each group (the fair comparison when one group is much larger), Count overlays the raw numbers, and Stacked adds them into one total that matches the unsplit chart — days with no day type recorded (before 2020) are included there as a grey layer on top. Click a legend entry to hide or show a group.";

export const CALENDAR_INTERACTION_GUIDE =
  "Each cell is one day, shaded by its value — hover a cell for the exact figure, or on a touchscreen tap it (tap anywhere else to close). Where a day is made of several categories, its colour is their mix, and the tooltip lists what went into it. On a narrow screen each year becomes a grid of month calendars, Monday first, with the most recent year at the top. Use the range picker above to focus on a shorter stretch.";

export const AREA_INTERACTION_GUIDE =
  "Each band is labelled inside itself, as large as it fits; bands too thin for a label are still there — hover or focus any band to see what it is, and use the arrow keys to step through its values. Where a category has its own colour elsewhere in the app (a tag, a place) the band uses it; otherwise the top five get distinct colours and the rest share a pale beige. Past 100 bands, the smallest are folded into one Other band.";

export const NETWORK_INTERACTION_GUIDE =
  "The layout is live: drag a node and its connections follow, let go and it settles back into place. Hover a node for its details; click one to highlight it and its neighbours and zoom in on them, and click another node or the background to move or clear that. With nothing selected, clicking the background fits the whole graph back into view. Scroll or pinch to zoom, drag the background to pan. Names appear on more nodes as you zoom in, and initials inside any node big enough to hold them. Where there’s a legend, click an entry to hide that group — the rest of the graph slides to fill the gap. Where there’s a Play control, it grows the graph month by month from the first logged day — drag the scrubber to see the network as it stood at any month, pick a speed, and drag a node to pause.";

export const RANKED_INTERACTION_GUIDE =
  "Use the pickers above to choose what's ranked, and at what level where there's a choice. Click a column header to sort by it, again to reverse, and a third time (or click #) to return to rank order — the # column always shows the real rank. Every entry is included: more rows load as you scroll. Hover a movement arrow for where that entry stood then and now, a shaded number for its exact value, or a header for what the column measures. On a narrow screen, scroll the table sideways; the rank and name stay pinned.";

export const DONUT_INTERACTION_GUIDE =
  "Click a slice to zoom into it; click the center (or press Escape) to zoom back out. Hover a slice for its exact value. Right-click a slice — or focus it and press Delete or x — to exclude it from the chart; the remaining slices re-base against the reduced total, and a row below the breadcrumb lists what's excluded, with its own weight, and lets you restore it one at a time or all at once.";

export const TREEMAP_INTERACTION_GUIDE =
  "Each tile's area is its share of the whole. Click a tile to zoom into the group it belongs to; click a step in the path above the chart (or press Escape) to zoom back out. Hover or focus a tile for its exact value and its share of its group and of the whole. Tiles too small for a name show initials or nothing — zoom in, or hover, to read them. Where there's a Play control, it plays the treemap month by month from the first logged day, each tile growing or shrinking in place rather than jumping around — drag the scrubber to see it as it stood at any month, and pick a speed.";

export const GEO_INTERACTION_GUIDE =
  "Scroll or pinch to zoom, drag to pan. Click a region to drill into it where that's available; hover a region or marker for its exact value, or for what's known about it where there's no figure to show. A region's name is written on it once it is large enough on screen to hold it, so zooming in names more of them. On a city map, a white outline marks the central city of a metro area. Highways and major roads are drawn faintly and grow clearer as you zoom in.";

// The city heatmaps' guide (#639): the shared geo guide above, plus the
// Roads & metro switch and what the metro looks like. The world and US-state
// maps have neither, so they keep the shared text alone.
export const CITY_HEATMAP_INTERACTION_GUIDE = `${GEO_INTERACTION_GUIDE} The Roads & metro switch shows or hides the road network and the metro lines together. Metro lines are drawn in the accent colour, and metro stations appear as rings once you zoom in close enough to place them.`;

/** The Centre of Gravity map (#215) — built on `InteractiveGeo`, but its
 * content is all markers and a path, with no choropleth or drill-down,
 * so the generic geo paragraph above would promise things it doesn't do. */
export const LOCATION_CENTRE_INTERACTION_GUIDE =
  "The line traces the centre of mass of where I spent my days, each point averaging the window of years before it, coloured from earliest (pale) to latest (strong). Window sets how many years back each point looks: 1 year shows moves and long stretches away, 5 years only the broad drift between homes. Smoothing (off by default) averages the line once more, over the points around it, so it runs as a smooth curve near the dots rather than through each one: Smooth for a gentle curve, Smoother for only the broad sweep. With it on, the unsmoothed line stays visible beneath the curve, faint and dashed. The dots, their tooltips and their breakdowns always describe the real windows, whatever the smoothing; near the ends, a smoothed line can stop a little short of the first dot and of Now. Drag the Years slider's two handles to show any span of whole years; the circles and the coverage figure follow the span, and bringing both handles to the same year shows that year month by month. A labelled dot marks where each year begins (each month, in a single year), and a dot labelled Now marks the latest point; one dot labelled with several years (\"2016–2018\") is where the line sat at the start of each of them. In a span of several years, small dots between the year dots mark every two months. The line breaks where too few days are located to place, and a dashed line bridges the gap. The shaded circles are the areas being averaged (a metro, or a municipality outside one), sized by their share of the span's days; the ten with the most days overall each have their own colour and their name on the map, and keep that colour in every tooltip and in the key above the map. Hover any dot for the days behind it and how they split between areas: the bar shows the whole mix, and the three largest areas are named with their shares. Click a dot (or focus it and press Enter) to pin a full breakdown of its window: the exact dates, every area with its share, the countries, and the areas first visited in that window. Click the dot again, press Escape or use the close button to dismiss it. Hover a circle for its share of the span. Scroll or pinch to zoom, drag to pan, click a country to zoom to it, and click the background to reset.";

export const BUMP_INTERACTION_GUIDE =
  "Each ribbon is one item, and its height at a year is its rank then, 1 at the top. Hover a ribbon to highlight it and see its rank in every year; the rest fade. Focus the chart and use the arrow keys to step through the ribbons one at a time. A gap in a ribbon means it wasn't in the list that year. Names appear at the first and last year; ribbons that came and went in between are named by hovering them. On a narrow screen the names are left off and hovering does all the naming.";

export const BAR_RACE_INTERACTION_GUIDE =
  "Use the playback controls to run, pause, or scrub the animation. Hover a bar for its exact value at that point in time.";

export const COMBO_INTERACTION_GUIDE =
  "Hover a point or bar for its exact value and date.";

export const TIMELINE_INTERACTION_GUIDE =
  "Drag the period slider or scroll the chart to zoom, drag to pan. Hover or focus an entry for its dates and length.";

/** The Sleep Hours chart (#212) — bespoke, not built on a shared
 * primitive, so it gets its own paragraph rather than borrowing one that
 * would promise zoom it doesn't have. */
export const SLEEP_HOURS_INTERACTION_GUIDE =
  "Each bar is one night, from falling asleep at its top to waking at its bottom, coloured by the kind of day it led into. The chart opens on the whole history and zooms in to the last three months; touch it, or the slider, and the animation stops where it is. Scroll on the chart to zoom, drag to pan, double-click to show everything; the period slider moves the same window. Hover a night, or focus the chart and use the left and right arrow keys, for when you fell asleep and woke up. Click a legend entry to hide that day type. The Regions picker shades jobs, homes, relationships or age behind the bars. The clock axis refits to the nights in view.";

/** Shown in the popup's Methodology section until a chart has real,
 * hand-written copy from #316 — the content follow-up ticket. Deliberately
 * visible rather than hidden, so a placeholder reads as "not written yet"
 * instead of silently missing. */
export const PLACEHOLDER_METHODOLOGY =
  "Methodology write-up pending — see issue #316.";
