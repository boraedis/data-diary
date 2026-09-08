import Link from "next/link";
import { ChartsCatalogSearch } from "@/components/charts/charts-catalog-search";
import { CHARTS } from "@/lib/charts-catalog";

// Full, searchable catalog (#268) — the fallback for "I know roughly what
// I want, let me just search" rather than browsing favorites/categories.
export default function AllChartsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">All charts</h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartsCatalogSearch charts={CHARTS} />
    </main>
  );
}
