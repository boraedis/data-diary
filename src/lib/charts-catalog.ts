// Single source of truth for /charts navigation (#268) — the landing page's
// favorites row and category cards, /charts/all's searchable catalog, and
// /charts/category/[slug] all read from this one list instead of each
// hand-rolling their own subset.
//
// Categories mirror the day-entry taxonomy from `summarize()` in
// src/app/(app)/day/[date]/page.tsx, not an invented chart-specific one —
// keeps the vocabulary consistent across the app. `subs`, `entertainment`
// and `work` are deliberately omitted: no chart types exist for them yet
// (see #109, #120), and a category with zero charts has nothing to link to.
//
// `life` is the one category with no day-entry counterpart, and that's the
// point of it: every other chart here aggregates `days` rows, while the
// life timeline (#310) is sourced from the profile tables — declared
// intervals about the person, not logged days. Filing it under `places`
// for the residences, or a hypothetical `work` for the jobs, would each
// name a third of the chart and misfile the rest.
export type ChartCategory =
  | "happiness"
  | "sleep"
  | "health"
  | "weight"
  | "technology"
  | "social-media"
  | "places"
  | "people"
  | "life";

export const CHART_CATEGORIES: Record<ChartCategory, { label: string; description: string }> = {
  happiness: {
    label: "Happiness",
    description: "Mood, journal reasons, and day types.",
  },
  sleep: {
    label: "Sleep",
    description: "Nightly duration, timing, and where you slept.",
  },
  health: {
    label: "Health & Fitness",
    description: "Coffee, distance walked, and training.",
  },
  weight: {
    label: "Weight",
    description: "Body weight against training volume.",
  },
  technology: {
    label: "Screen Time",
    description: "Phone and laptop usage.",
  },
  "social-media": {
    label: "Social Media",
    description: "Instagram follower growth.",
  },
  places: {
    label: "Places",
    description: "Where your days happen, by place and geography.",
  },
  people: {
    label: "People",
    description: "Who you log your days with.",
  },
  life: {
    label: "Life",
    description: "Jobs, homes and relationships, as spans of time.",
  },
};

// Rendered in this order on the landing page's category grid.
export const CHART_CATEGORY_ORDER: ChartCategory[] = [
  "happiness",
  "sleep",
  "health",
  "weight",
  "technology",
  "social-media",
  "places",
  "people",
  "life",
];

export interface ChartEntry {
  href: string;
  title: string;
  description: string;
  category: ChartCategory;
}

export const CHARTS: ChartEntry[] = [
  {
    href: "/charts/happiness-hist",
    title: "Happiness histogram",
    description: "The distribution of happiness ratings across every day logged.",
    category: "happiness",
  },
  {
    href: "/charts/happiness-trend",
    title: "Happiness trend",
    description: "The long-run trend in happiness over time, aggregated by period.",
    category: "happiness",
  },
  {
    href: "/charts/happiness-daily",
    title: "Daily happiness",
    description: "A detailed, day-by-day look at happiness ratings.",
    category: "happiness",
  },
  {
    href: "/charts/happiness-calendar",
    title: "Happiness calendar",
    description: "A year-by-year heatmap of daily happiness.",
    category: "happiness",
  },
  {
    href: "/charts/day-types",
    title: "Day types calendar",
    description: "Work, days off, vacation and travel across the years.",
    category: "happiness",
  },
  {
    href: "/charts/weight",
    title: "Weight over time",
    description: "Zoomable line — drag the strip below to zoom into a range.",
    category: "weight",
  },
  {
    href: "/charts/coffee-trend",
    title: "Coffee trend",
    description: "Monthly average cups per day, with each month's range.",
    category: "health",
  },
  {
    href: "/charts/coffee-calendar",
    title: "Coffee calendar",
    description: "A year-by-year heatmap of cups per day.",
    category: "health",
  },
  {
    href: "/charts/distance-trend",
    title: "Distance walked trend",
    description: "Monthly average kilometres per day.",
    category: "health",
  },
  {
    href: "/charts/distance-daily",
    title: "Daily distance walked",
    description: "Every logged day — zoom and pan through the range.",
    category: "health",
  },
  {
    href: "/charts/training-volume",
    title: "Training volume",
    description: "Total hours trained each month, with session detail on hover.",
    category: "health",
  },
  {
    href: "/charts/sleep",
    title: "Sleep calendar",
    description: "A year-by-year heatmap of nightly sleep duration.",
    category: "sleep",
  },
  {
    href: "/charts/sleep-trend",
    title: "Sleep trend",
    description: "Average time asleep per night, at any bucket size.",
    category: "sleep",
  },
  {
    href: "/charts/sleep-daily",
    title: "Nightly sleep",
    description: "Every logged night — zoom and pan through the range.",
    category: "sleep",
  },
  {
    href: "/charts/sleep-locations",
    title: "Sleep locations",
    description: "Where you slept, as a share of nights over time.",
    category: "sleep",
  },
  {
    href: "/charts/gym",
    title: "Weight & training volume",
    description: "Body weight against how many workouts you logged each month.",
    category: "weight",
  },
  {
    href: "/charts/exercise-mix",
    title: "Exercise mix",
    description: "Workout count by category, exercise, or subtype, over any time range.",
    category: "health",
  },
  {
    href: "/charts/screen-time",
    title: "Screen time",
    description: "Phone against laptop, and how the balance has shifted.",
    category: "technology",
  },
  {
    href: "/charts/screen-time-daily",
    title: "Daily screen time",
    description: "Every logged day — zoom and pan through the range.",
    category: "technology",
  },
  {
    href: "/charts/screen-time-calendar",
    title: "Screen time calendar",
    description: "Both devices on one grid, coloured by which dominated.",
    category: "technology",
  },
  {
    href: "/charts/instagram",
    title: "Instagram followers",
    description: "Follower count over time.",
    category: "social-media",
  },
  {
    href: "/charts/places",
    title: "Most-visited places",
    description: "Ranked by how often each place filled your day's two place slots.",
    category: "places",
  },
  {
    href: "/charts/place-hierarchy",
    title: "Place hierarchy",
    description: "A zoomable sunburst of where your days happen, by geography or category.",
    category: "places",
  },
  {
    href: "/charts/place-history",
    title: "Where you were",
    description: "Days spent in each country, as a share over time.",
    category: "places",
  },
  {
    href: "/charts/people",
    title: "People network",
    description: "Who gets logged together — drag nodes to reposition.",
    category: "people",
  },
  {
    href: "/charts/people-over-time",
    title: "Who you saw",
    description: "Days logged with each person, as a share over time.",
    category: "people",
  },
  {
    href: "/charts/people-table",
    title: "People table",
    description: "Everyone ranked by days logged, with recent rank movement.",
    category: "people",
  },
  {
    href: "/charts/people-calendar",
    title: "People calendar",
    description: "How many people you logged each day.",
    category: "people",
  },
  {
    href: "/charts/people-impact",
    title: "People impact",
    description: "Who contributed most to how your days went, week by week.",
    category: "people",
  },
  {
    href: "/charts/people-race",
    title: "People race",
    description: "An animated ranking of who mattered most, week by week.",
    category: "people",
  },
  {
    href: "/charts/world",
    title: "Days per country",
    description: "A world map colored by how many days you've logged in each country.",
    category: "places",
  },
  {
    href: "/charts/us-states",
    title: "Days per state",
    description: "A US map colored by how many days you've logged in each state.",
    category: "places",
  },
  {
    href: "/charts/city-heatmap",
    title: "City heatmap",
    description: "Neighborhood-level maps for Atlanta, DC metro, Dubai, NYC, and Istanbul, with your top destinations marked.",
    category: "places",
  },
  {
    href: "/charts/life-timeline",
    title: "Life timeline",
    description: "Jobs, homes and relationships as overlapping spans of time.",
    category: "life",
  },
] as const satisfies ChartEntry[];

// Hand-picked, not usage-derived (#268 triage decision) — a short, stable
// list of the charts checked most often. Edit directly to change what
// shows up in the landing page's favorites row.
export const FAVORITE_CHART_HREFS: readonly string[] = [
  "/charts/happiness-trend",
  "/charts/weight",
  "/charts/sleep-trend",
  "/charts/people-table",
  "/charts/places",
];

export function chartsByCategory(category: ChartCategory): ChartEntry[] {
  return CHARTS.filter((chart) => chart.category === category);
}
