import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_CATEGORIES, CHART_CATEGORY_ORDER, type ChartCategory, chartsByCategory } from "@/lib/charts-catalog";

// Nested under /charts/category rather than directly at /charts/[slug]
// (#268) — several category names (happiness, weight, sleep, places,
// people) collide with existing individual chart routes at /charts/*, and
// Next resolves static routes before dynamic ones, so a bare /charts/[slug]
// would make those categories unreachable.
export function generateStaticParams() {
  return CHART_CATEGORY_ORDER.map((category) => ({ slug: category }));
}

function isChartCategory(slug: string): slug is ChartCategory {
  return (CHART_CATEGORY_ORDER as string[]).includes(slug);
}

export default async function ChartCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isChartCategory(slug)) {
    notFound();
  }

  const charts = chartsByCategory(slug);
  const { label, description } = CHART_CATEGORIES[slug];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">{label}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {charts.map((chart) => (
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
