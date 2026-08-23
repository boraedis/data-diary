import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Phase 4 — see REBUILD_PLAN.md for the full ~55-chart legacy inventory,
// which of these were picked first and why, and what's still blocked
// pending Phase 5 (entertainment/finance/location catalogs).
const CHARTS = [
  {
    href: "/charts/happiness",
    title: "Happiness distribution",
    description: "How your day-to-day happiness score is spread out, 0-100.",
  },
  {
    href: "/charts/happiness-trend",
    title: "Happiness trend",
    description: "Monthly average happiness over time.",
  },
  {
    href: "/charts/weight",
    title: "Weight over time",
    description: "Zoomable line — drag the strip below to zoom into a range.",
  },
  {
    href: "/charts/sleep",
    title: "Sleep calendar",
    description: "A year-by-year heatmap of nightly sleep duration.",
  },
  {
    href: "/charts/gym",
    title: "Weight & training volume",
    description: "Body weight against how many workouts you logged each month.",
  },
  {
    href: "/charts/subs",
    title: "Subs over time",
    description: "A mini trend chart per sub, side by side.",
  },
  {
    href: "/charts/places",
    title: "Most-visited places",
    description: "Ranked by how often each place filled your day's two place slots.",
  },
  {
    href: "/charts/people",
    title: "People network",
    description: "Who gets logged together — drag nodes to reposition.",
  },
] as const;

export default function ChartsIndexPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Charts</h1>
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          Home
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHARTS.map((chart) => (
          <Link key={chart.href} href={chart.href}>
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader>
                <CardTitle>{chart.title}</CardTitle>
                <CardDescription>{chart.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
