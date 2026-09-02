import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { PodcastCategoryPanel } from "@/components/manage/podcast-category-panel";
import { ReviewProgressRow } from "@/components/manage/review-progress-row";
import { listPodcastCategories, listPodcastShows } from "@/lib/catalog-admin";
import { getMusicCurationStats } from "@/lib/music";
import type { SearchItem } from "@/components/entry-forms/search-panel";

export const dynamic = "force-dynamic";

export default async function ManagePodcastsPage() {
  const [shows, categories, curation] = await Promise.all([
    listPodcastShows(),
    listPodcastCategories(),
    getMusicCurationStats(),
  ]);
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const items: SearchItem[] = shows.map((show) => ({
    id: show.id,
    primary: show.name,
    secondary: show.categoryId ? categoryNameById.get(show.categoryId) : undefined,
  }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Podcasts</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>

      {curation.totalPodcastShows > 0 && (
        <Card>
          <CardContent>
            <ReviewProgressRow
              label="Shows categorized"
              href="#shows"
              done={curation.categorizedPodcastShows}
              total={curation.totalPodcastShows}
            />
          </CardContent>
        </Card>
      )}

      <div id="shows" className="scroll-mt-4">
        <CatalogBrowser
          items={items}
          basePath="/manage/entertainment/music/podcasts"
          placeholder="Search podcast shows…"
          emptyMessage="No podcast shows yet — import some listens first."
        />
      </div>

      <PodcastCategoryPanel initial={categories} />
    </main>
  );
}
