import type { Metadata } from "next";
import Link from "next/link";
import { ChartsCatalogSearch } from "@/components/charts/charts-catalog-search";
import { PUBLIC_CHARTS } from "@/lib/public-charts-catalog";

export const metadata: Metadata = {
  title: "All charts — Data Diary",
  description: "The full list of public charts, searchable by name.",
};

// Public counterpart to src/app/(app)/charts/all/page.tsx (#268 follow-up).
export default function PublicAllChartsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">All charts</h1>
        <Link href="/public-charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartsCatalogSearch charts={PUBLIC_CHARTS} />
    </main>
  );
}
