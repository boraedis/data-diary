import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EntertainmentManageList } from "@/components/manage/entertainment-manage-list";
import {
  listBooksCatalog,
  listEntertainmentCatalog,
  listMoviesCatalog,
  listSportsCatalog,
  listTvShowsCatalog,
} from "@/lib/days";

export const dynamic = "force-dynamic";

// One card per entertainment kind that has its own real management feature
// (mirrors the day-entry entertainment hub's "kind card here, form lives
// under entertainment/<kind>" pattern — see
// src/app/day/[date]/entertainment/page.tsx). Music doesn't have one yet
// (see REBUILD_PLAN.md — built one at a time; it's bulk Spotify import, not
// a day-entry feature, so it may never need a card here at all), so it
// shows as a non-clickable placeholder rather than a card that goes
// nowhere; the generic EntertainmentManageList below still covers every
// kind, including this one, until it gets its own dedicated feature.
const COMING_SOON = ["Music"] as const;

export default async function ManageEntertainmentPage() {
  const [items, movies, tvShows, sports, books] = await Promise.all([
    listEntertainmentCatalog(),
    listMoviesCatalog(),
    listTvShowsCatalog(),
    listSportsCatalog(),
    listBooksCatalog(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Entertainment</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <Link href="/manage/entertainment/movies">
          <Card size="sm" className="transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Movies</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{movies.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/tvshows">
          <Card size="sm" className="transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>TV shows</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{tvShows.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/sports">
          <Card size="sm" className="transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Sports</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{sports.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/books">
          <Card size="sm" className="transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Books</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{books.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        {COMING_SOON.map((label) => (
          <Card key={label} size="sm" className="opacity-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{label}</CardTitle>
                <span className="text-xs text-muted-foreground">Coming soon</span>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Everything else — entertainment not yet migrated to its own kind above.
        </p>
        <EntertainmentManageList initial={items} />
      </div>
    </main>
  );
}
