import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { GenreCatalogPanel } from "@/components/manage/genre-catalog-panel";
import { ReviewProgressRow } from "@/components/manage/review-progress-row";
import { listArtists, listGenreGroups, listGenres } from "@/lib/catalog-admin";
import { getMusicCurationStats } from "@/lib/music";
import type { SearchItem } from "@/components/entry-forms/search-panel";

export const dynamic = "force-dynamic";

function toSearchItem(artist: Awaited<ReturnType<typeof listArtists>>[number]): SearchItem {
  return {
    id: artist.id,
    primary: artist.name,
    secondary: artist.genres.slice(0, 3).join(", ") || undefined,
    searchTerms: artist.aliases,
  };
}

export default async function ManageArtistsPage() {
  const [artists, genreGroups, genres, curation] = await Promise.all([
    listArtists(),
    listGenreGroups(),
    listGenres(),
    getMusicCurationStats(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Artists</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>

      {curation.totalGenres > 0 && (
        <Card>
          <CardContent>
            <ReviewProgressRow
              label="Genres grouped"
              href="#genres"
              done={curation.groupedGenres}
              total={curation.totalGenres}
            />
          </CardContent>
        </Card>
      )}

      <CatalogBrowser
        items={artists.map(toSearchItem)}
        basePath="/manage/entertainment/music/artists"
        placeholder="Search artists…"
        emptyMessage="No artists yet — import some listens first."
      />

      <GenreCatalogPanel initialGenreGroups={genreGroups} initialGenres={genres} />
    </main>
  );
}
