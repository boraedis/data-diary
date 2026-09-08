import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_CATEGORIES, PUBLIC_CHART_CATEGORY_ORDER, publicChartsByCategory } from "@/lib/public-charts-catalog";

export const metadata: Metadata = {
  title: "Charts — Data Diary",
  description: "A curated set of public charts from the diary's logged history.",
};

// Public counterpart to src/app/(app)/charts/page.tsx (#268 follow-up) —
// category cards rather than one flat grid, same as the private landing.
// No favorites row: with the curated public set still small, a favorites
// subset would just repeat "browse by category" one section up. Revisit
// once #96 grows PUBLIC_CHART_TYPES enough that favorites earns its keep.
export default function PublicChartsIndexPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Charts</h1>
        <div className="flex items-center gap-4">
          <Link href="/public-charts/all" className="text-xs text-muted-foreground hover:text-foreground">
            All charts
          </Link>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            Front page
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {PUBLIC_CHART_CATEGORY_ORDER.map((category) => {
          const count = publicChartsByCategory(category).length;
          return (
            <Link key={category} href={`/public-charts/category/${category}`}>
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
    </main>
  );
}
