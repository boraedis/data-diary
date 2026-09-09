import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArtistsBrowser } from "@/components/manage/artists-browser";
import { GenreCatalogPanel } from "@/components/manage/genre-catalog-panel";
import { ReviewProgressRow } from "@/components/manage/review-progress-row";
import { listArtists, listGenreGroups, listGenres } from "@/lib/catalog-admin";
import { getMusicCurationStats } from "@/lib/music";

export const dynamic = "force-dynamic";

export default async function ManageArtistsPage() {
  const [artists, genreGroups, genres, curation] = await Promise.all([
    listArtists(),
    listGenreGroups(),
    listGenres(),
    getMusicCurationStats(),
  ]);
  const artistsWithGenres = artists.filter((a) => a.genres.length > 0).length;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Artists</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>

      {(curation.totalGenres > 0 || artists.length > 0) && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            {curation.totalGenres > 0 && (
              <ReviewProgressRow
                label="Genres grouped"
                href="#genres"
                done={curation.groupedGenres}
                total={curation.totalGenres}
              />
            )}
            {artists.length > 0 && (
              <ReviewProgressRow
                label="Artists with a genre"
                href="#artist-list"
                done={artistsWithGenres}
                total={artists.length}
              />
            )}
          </CardContent>
        </Card>
      )}

      <ArtistsBrowser artists={artists} />

      <GenreCatalogPanel initialGenreGroups={genreGroups} initialGenres={genres} />
    </main>
  );
}
