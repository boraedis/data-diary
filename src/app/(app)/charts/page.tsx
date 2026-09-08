import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHART_CATEGORIES,
  CHART_CATEGORY_ORDER,
  CHARTS,
  FAVORITE_CHART_HREFS,
  chartsByCategory,
} from "@/lib/charts-catalog";

// Landing page for the chart catalog (#268) — a hand-picked favorites row
// plus category cards, rather than one flat grid of every chart. Browsing
// everything at once, or searching by name, lives at /charts/all; a single
// category's full chart list lives at /charts/category/[slug].
export default function ChartsIndexPage() {
  const favorites = CHARTS.filter((chart) => FAVORITE_CHART_HREFS.includes(chart.href));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Charts</h1>
        <div className="flex items-center gap-4">
          <Link href="/charts/all" className="text-xs text-muted-foreground hover:text-foreground">
            All charts
          </Link>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            Home
          </Link>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Favorites</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {favorites.map((chart) => (
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
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Browse by category</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {CHART_CATEGORY_ORDER.map((category) => {
            const count = chartsByCategory(category).length;
            return (
              <Link key={category} href={`/charts/category/${category}`}>
                <Card className="h-full transition-colors hover:bg-accent">
                  <CardHeader>
                    <CardTitle>{CHART_CATEGORIES[category].label}</CardTitle>
                    <CardDescription>{CHART_CATEGORIES[category].description}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {count} chart{count === 1 ? "" : "s"}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
