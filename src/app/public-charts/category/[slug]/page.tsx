import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHART_CATEGORIES,
  PUBLIC_CHART_CATEGORY_ORDER,
  publicChartsByCategory,
  type ChartCategory,
} from "@/lib/public-charts-catalog";

// Public counterpart to src/app/(app)/charts/category/[slug]/page.tsx
// (#268 follow-up) — nested under /category for the same reason: category
// names like "weight" and "sleep" collide with existing individual public
// chart routes at /public-charts/*.
export function generateStaticParams() {
  return PUBLIC_CHART_CATEGORY_ORDER.map((category) => ({ slug: category }));
}

function isPublicChartCategory(slug: string): slug is ChartCategory {
  return (PUBLIC_CHART_CATEGORY_ORDER as string[]).includes(slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isPublicChartCategory(slug)) return {};
  return { title: `${CHART_CATEGORIES[slug].label} — Data Diary` };
}

export default async function PublicChartCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isPublicChartCategory(slug)) {
    notFound();
  }

  const charts = publicChartsByCategory(slug);
  const { label, description } = CHART_CATEGORIES[slug];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">{label}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Link href="/public-charts" className="text-xs text-muted-foreground hover:text-foreground">
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
