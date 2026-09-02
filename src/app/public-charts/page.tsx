import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PUBLIC_CHART_TYPES } from "@/lib/public-content";

export const metadata: Metadata = {
  title: "Charts — Data Diary",
  description: "A curated set of public charts from the diary's logged history.",
};

// Public counterpart to src/app/charts/page.tsx (#84) — a navigation index
// of curated chart types rather than one page dumping all of them
// together, so each chart gets its own route (and its own filters/tools
// row, same as its private counterpart) rather than a stripped-down
// read-only showcase. PUBLIC_CHART_TYPES (public-content.ts) is the same
// curated allowlist that decides what's exposed here — keep this list and
// that one in sync.
const CHARTS: Record<(typeof PUBLIC_CHART_TYPES)[number], { title: string; description: string }> = {
  weight: {
    title: "Weight over time",
    description: "Zoomable line — drag the strip below to zoom into a range.",
  },
  "happiness-trend": {
    title: "Happiness trend",
    description: "Monthly average happiness over time.",
  },
  sleep: {
    title: "Sleep calendar",
    description: "A year-by-year heatmap of nightly sleep duration.",
  },
};

export default function PublicChartsIndexPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Charts</h1>
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          Front page
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {PUBLIC_CHART_TYPES.map((type) => (
          <Link key={type} href={`/public-charts/${type}`}>
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader>
                <CardTitle>{CHARTS[type].title}</CardTitle>
                <CardDescription>{CHARTS[type].description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
