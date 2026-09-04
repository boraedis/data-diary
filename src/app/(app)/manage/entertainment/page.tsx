import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntertainmentManageList } from "@/components/manage/entertainment-manage-list";
import {
  listBooksCatalog,
  listEntertainmentCatalog,
  listGamesCatalog,
  listMoviesCatalog,
  listSportsCatalog,
  listTvShowsCatalog,
} from "@/lib/days";
import { listEntertainmentKinds } from "@/lib/catalog-admin";
import { getMusicCurationStats, getMusicListenStats } from "@/lib/music";

export const dynamic = "force-dynamic";

// One card per entertainment kind that has its own real management feature
// (mirrors the day-entry entertainment hub's "kind card here, form lives
// under entertainment/<kind>" pattern — see
// src/app/day/[date]/entertainment/page.tsx). Music (issue #76) is a bulk
// Spotify import rather than a day-entry feature, so it never gets a
// day-entry form the way the others do, but it does get its own manage
// page — deliberately not in the generic EntertainmentManageList below,
// which is backed by entertainmentCatalog/entertainmentEntries and never
// held music data.

export default async function ManageEntertainmentPage() {
  const [items, movies, tvShows, sports, books, games, kinds, musicStats, musicCuration] = await Promise.all([
    listEntertainmentCatalog(),
    listMoviesCatalog(),
    listTvShowsCatalog(),
    listSportsCatalog(),
    listBooksCatalog(),
    listGamesCatalog(),
    listEntertainmentKinds(),
    getMusicListenStats(),
    getMusicCurationStats(),
  ]);

  const musicNeedsReview =
    musicCuration.totalGenres -
    musicCuration.groupedGenres +
    (musicCuration.totalPodcastShows - musicCuration.categorizedPodcastShows);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Entertainment</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage Home
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        <Link href="/manage/entertainment/movies">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Movies</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{movies.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/tvshows">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>TV shows</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{tvShows.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/sports">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Sports</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{sports.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/books">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Books</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{books.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/games">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Games</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{games.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/music">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Music</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{musicStats.totalListens}</span>
              </div>
            </CardHeader>
            {musicNeedsReview > 0 && (
              <CardContent>
                <p className="text-xs text-muted-foreground">{musicNeedsReview} genres/shows need review</p>
              </CardContent>
            )}
          </Card>
        </Link>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Everything else — entertainment not yet migrated to its own kind above.
        </p>
        <EntertainmentManageList initial={items} initialKinds={kinds} />
      </div>

      <div className="flex justify-end">
        <Link href="/manage/entertainment/location-types" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Manage Location Types
        </Link>
      </div>
    </main>
  );
}
