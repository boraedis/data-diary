// Curated, hardcoded list of chart types to show on the public landing
// page (#12) — deliberately not a general "publish this chart" flag or
// admin UI, per the epic's locked decision: something is added to this
// list in code when it should go public, rather than a mechanism that
// lets it happen implicitly. Empty until #84 (public charts section)
// picks its initial set — the public data boundary (#82) stands on its
// own without it.
export const PUBLIC_CHART_TYPES: readonly string[] = [];
