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
    title: "Happiness Histogram",
    description: "The distribution of happiness ratings across every day logged.",
    category: "happiness",
  },
  {
    href: "/charts/happiness-trend",
    title: "Happiness Trend",
    description: "Trend in happiness over time, aggregated by period.",
    category: "happiness",
  },
  {
    href: "/charts/happiness-daily",
    title: "Daily Happiness",
    description: "A detailed, day-by-day look at happiness ratings.",
    category: "happiness",
  },
  {
    href: "/charts/happiness-calendar",
    title: "Happiness Calendar",
    description: "A year-by-year heatmap of daily happiness.",
    category: "happiness",
  },
  {
    href: "/charts/day-types",
    title: "Day Types Calendar",
    description: "Work, days off, vacation and travel across the years.",
    category: "happiness",
  },
  {
    href: "/charts/weight",
    title: "Daily Weight",
    description: "A day-by-day look at weight, body fat %, and muscle mass.",
    category: "weight",
  },
  {
    href: "/charts/coffee-trend",
    title: "Coffee Trend",
    description: "Trend in coffee over time, aggregated by period.",
    category: "health",
  },
  {
    href: "/charts/coffee-calendar",
    title: "Coffee Calendar",
    description: "A year-by-year heatmap of cups per day.",
    category: "health",
  },
  {
    href: "/charts/distance-trend",
    title: "Distance Walked Trend",
    description: "Trend in distance walked over time, aggregated by period.",
    category: "health",
  },
  {
    href: "/charts/distance-daily",
    title: "Daily Distance Walked",
    description: "A day-by-day look at distance walked.",
    category: "health",
  },
  {
    href: "/charts/training-volume",
    title: "Exercise Trend",
    description: "Trend in training hours over time, aggregated by period.",
    category: "health",
  },
  {
    href: "/charts/sleep",
    title: "Sleep Calendar",
    description: "A year-by-year heatmap of nightly sleep duration.",
    category: "sleep",
  },
  {
    href: "/charts/sleep-trend",
    title: "Sleep Trend",
    description: "Trend in sleep duration over time, aggregated by period.",
    category: "sleep",
  },
  {
    href: "/charts/sleep-daily",
    title: "Nightly Sleep",
    description: "A night-by-night look at sleep duration.",
    category: "sleep",
  },
  {
    href: "/charts/sleep-locations",
    title: "Sleep Locations",
    description: "Where you slept, as a share of nights over time.",
    category: "sleep",
  },
  {
    href: "/charts/gym",
    title: "Weight and Training Volume",
    description: "Body weight against how many workouts you logged each month.",
    category: "weight",
  },
  {
    href: "/charts/exercise-mix",
    title: "Exercise Mix",
    description: "A breakdown of how I exercised, aggregated by period.",
    category: "health",
  },
  {
    href: "/charts/screen-time",
    title: "Screen Time Mix",
    description: "A breakdown of phone vs. laptop usage, aggregated by period.",
    category: "technology",
  },
  {
    href: "/charts/screen-time-daily",
    title: "Daily Screen Time",
    description: "A day-by-day look at screen time.",
    category: "technology",
  },
  {
    href: "/charts/screen-time-calendar",
    title: "Screen Time Calendar",
    description: "Both devices on one grid, coloured by which dominated.",
    category: "technology",
  },
  {
    href: "/charts/instagram",
    title: "Instagram Followers",
    description: "A day-by-day look at Instagram followers.",
    category: "social-media",
  },
  {
    href: "/charts/places",
    title: "Place Leaderboard",
    description: "A leaderboard of my most mentioned locations.",
    category: "places",
  },
  {
    href: "/charts/place-hierarchy",
    title: "Place Sunburst",
    description: "A zoomable donut chart that lets you explore where I spent my time.",
    category: "places",
  },
  {
    href: "/charts/place-history",
    title: "Location Mix",
    description: "A breakdown of which countries you spent your time in, aggregated by period.",
    category: "places",
  },
  {
    href: "/charts/people",
    title: "People Network",
    description: "A network graph showing the relationship between people who get logged on the same days often.",
    category: "people",
  },
  {
    href: "/charts/people-over-time",
    title: "People Trend",
    description: "A breakdown of who you spent your time with, aggregated by period.",
    category: "people",
  },
  {
    href: "/charts/people-table",
    title: "People Leaderboard",
    description: "A leaderboard of the people you've logged the most.",
    category: "people",
  },
  {
    href: "/charts/people-calendar",
    title: "People Calendar",
    description: "A year-by-year heatmap of how many people you logged each day.",
    category: "people",
  },
  {
    href: "/charts/people-impact",
    title: "People Impact",
    description: "Who contributed most to how your days went, week by week.",
    category: "people",
  },
  {
    href: "/charts/people-race",
    title: "People Race",
    description: "An animated ranking of who impacted me the most.",
    category: "people",
  },
  {
    href: "/charts/world",
    title: "World Heatmap",
    description: "A heatmap of the world describing which countries I have visited and spent time in.",
    category: "places",
  },
  {
    href: "/charts/us-states",
    title: "US Heatmap",
    description: "A heatmap of the US describing where I have visited and spent time in.",
    category: "places",
  },
  {
    href: "/charts/city-heatmap",
    title: "City Heatmap",
    description: "A heatmap of the neighborhoods of Atlanta, DC, Dubai, NYC, and Istanbul describing where I have visited and spent time in.",
    category: "places",
  },
  {
    href: "/charts/life-timeline",
    title: "Life Timeline",
    description: "An interactive timeline of my various occupations, residences and relationships.",
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
