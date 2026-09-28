// Curated, hardcoded list of chart types shown on the public landing page
// (#12) — deliberately not a general "publish this chart" flag or admin
// UI, per the epic's locked decision: something is added to this list in
// code when it should go public, rather than a mechanism that lets it
// happen implicitly. The original three were picked in #84 for having no
// "subs", no address, no relationships, and no per-day free text in their
// data; "happiness-daily" joined later (#117 follow-up) on the same
// reasoning — see src/lib/public-charts.ts for the queries behind each.
//
// #453 added the rest, per the owner's per-chart decision posted on that
// issue: world/us-states (country/state-level only — no admin-region/
// county drill-down or unlogged-travel overlay publicly), sleep-trend,
// coffee-trend, distance-trend, exercise-mix, screen-time,
// music-leaderboard (artist/song names are public figures, not private
// people), and place-hierarchy (place names and mention counts, no lat/
// lng or address). `work-trend` was considered and deliberately excluded
// — the owner's call is that hours-worked/productivity data stays
// private indefinitely, not just deferred.
export const PUBLIC_CHART_TYPES = [
  "weight",
  "happiness-trend",
  "happiness-daily",
  "sleep",
  "world",
  "us-states",
  "sleep-trend",
  "coffee-trend",
  "distance-trend",
  "exercise-mix",
  "screen-time",
  "music-leaderboard",
  "place-hierarchy",
] as const;
