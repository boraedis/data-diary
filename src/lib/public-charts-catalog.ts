// Public counterpart to src/lib/charts-catalog.ts (#268 follow-up) — the
// public chart list is expected to grow substantially (see #96), so
// /public-charts gets the same favorites-free landing/all/category
// structure as the private /charts index rather than staying a flat grid
// forever.
//
// PUBLIC_CHART_TYPES (public-content.ts) stays the one explicit allow-list
// deciding what's public — nothing here makes a chart public by omission.
// This module only derives display metadata (title/description/category)
// for that allow-list from the shared private catalog, so the two don't
// drift out of sync with separately hand-typed copies of the same text.
import { CHARTS, CHART_CATEGORIES, CHART_CATEGORY_ORDER, type ChartCategory, type ChartEntry } from "@/lib/charts-catalog";
import { PUBLIC_CHART_TYPES } from "@/lib/public-content";

export { CHART_CATEGORIES };
export type { ChartCategory };

export const PUBLIC_CHARTS: ChartEntry[] = PUBLIC_CHART_TYPES.map((type) => {
  const privateChart = CHARTS.find((chart) => chart.href === `/charts/${type}`);
  if (!privateChart) {
    throw new Error(
      `PUBLIC_CHART_TYPES entry "${type}" has no matching /charts/${type} entry in charts-catalog.ts`
    );
  }
  return { ...privateChart, href: `/public-charts/${type}` };
});

// Only categories with at least one public chart — a category page with
// nothing in it has nothing to link to or browse.
export const PUBLIC_CHART_CATEGORY_ORDER: ChartCategory[] = CHART_CATEGORY_ORDER.filter((category) =>
  PUBLIC_CHARTS.some((chart) => chart.category === category)
);

export function publicChartsByCategory(category: ChartCategory): ChartEntry[] {
  return PUBLIC_CHARTS.filter((chart) => chart.category === category);
}
