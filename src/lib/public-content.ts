// Curated, hardcoded list of chart types shown on the public landing page
// (#12) — deliberately not a general "publish this chart" flag or admin
// UI, per the epic's locked decision: something is added to this list in
// code when it should go public, rather than a mechanism that lets it
// happen implicitly. The original three were picked in #84 for having no
// "subs", no address, no relationships, and no per-day free text in their
// data; "happiness-daily" joined later (#117 follow-up) on the same
// reasoning — see src/lib/public-charts.ts for the queries behind each.
export const PUBLIC_CHART_TYPES = ["weight", "happiness-trend", "happiness-daily", "sleep"] as const;
